'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const build = require('./build');
const { checkProject } = require('./check');
const {
  readPluginProject,
  resolveProjectPath,
  validateI18nFilename,
} = require('./manifest');
const { CliError, EXIT_CODES, validatePluginId } = require('./project');
const { assertPlatformCompatibility, inspectPlatformViaSsh } = require('./platform');
const {
  normalizeSshTarget,
  scpUpload,
  sshCapture,
  sshRun,
  validateRemoteFilename,
  withSshSession,
} = require('./ssh-transport');

const DEPLOY_STATE_DIR = '/usr/share/gl-sdk4-plugin-kit/deploy-state';

function ownedViewId(id, pluginId) {
  try {
    validatePluginId(id);
  } catch (error) {
    return false;
  }
  return id === pluginId || id.startsWith(`${pluginId}-`);
}

function isOwnedDeployPath(remotePath, pluginId) {
  const viewPrefix = '/www/views/gl-sdk4-ui-';
  const viewSuffix = '.common.js.gz';
  if (remotePath.startsWith(viewPrefix) && remotePath.endsWith(viewSuffix)) {
    return ownedViewId(remotePath.slice(viewPrefix.length, -viewSuffix.length), pluginId);
  }
  const menuPrefix = '/usr/share/oui/menu.d/';
  if (remotePath.startsWith(menuPrefix) && remotePath.endsWith('.json')) {
    return ownedViewId(remotePath.slice(menuPrefix.length, -'.json'.length), pluginId);
  }
  const i18nPrefix = '/www/i18n/';
  if (remotePath.startsWith(i18nPrefix)) {
    try {
      validateI18nFilename(remotePath.slice(i18nPrefix.length), pluginId);
      return true;
    } catch (error) {
      return false;
    }
  }
  return false;
}

function currentDeployPaths(views, i18nFiles) {
  return views.flatMap((view) => [
    `/www/views/gl-sdk4-ui-${view.id}.common.js.gz`,
    `/usr/share/oui/menu.d/${view.id}.json`,
  ]).concat(i18nFiles.map((filename) => `/www/i18n/${filename}`));
}

function parseDeployArgs(args, options) {
  const values = Array.isArray(args) ? args : [args].filter(Boolean);
  const settings = options || {};
  const parsed = { host: '', build: false, hostKeyPolicy: null, allowUnverified: false };

  values.forEach((value) => {
    if (value === '--build') parsed.build = true;
    else if (value === '--allow-unverified') parsed.allowUnverified = true;
    else if (value === '--insecure-host-key') parsed.hostKeyPolicy = 'insecure';
    else if (value === '--strict-host-key') parsed.hostKeyPolicy = 'strict';
    else if (value.startsWith('-')) {
      throw new CliError(`Unknown deploy option: ${value}`, EXIT_CODES.USAGE);
    }
    else if (!parsed.host) parsed.host = value;
    else throw new CliError(
      'Usage: glplugin deploy [target|host] [--build] [--insecure-host-key] [--allow-unverified]',
      EXIT_CODES.USAGE
    );
  });

  if (!parsed.host && !settings.allowMissingHost) {
    throw new CliError(
      'Target required. Usage: glplugin deploy [target|host] [--build] ' +
      '[--insecure-host-key] [--allow-unverified]',
      EXIT_CODES.USAGE
    );
  }
  return parsed;
}

module.exports = function deploy(input, options) {
  const settings = options || {};
  const parsed = parseDeployArgs(input, { allowMissingHost: Boolean(settings.resolveTarget) });
  const configuredTarget = settings.resolveTarget
    ? settings.resolveTarget(parsed.host)
    : { ssh: normalizeSshTarget(parsed.host).target, insecureHostKey: false };
  const target = configuredTarget.ssh;
  const cwd = settings.cwd ? path.resolve(settings.cwd) : process.cwd();
  const project = readPluginProject(cwd);
  const name = project.manifest.id;
  const log = settings.log || console.log;
  const transportOptions = {
    insecureHostKey: parsed.hostKeyPolicy === 'insecure' ||
      (parsed.hostKeyPolicy === null && configuredTarget.insecureHostKey),
    spawnSync: settings.spawnSync,
    quiet: settings.quiet || settings.json,
  };
  const views = project.manifest.views.map((view) => ({
    ...view,
    gzFile: path.join(cwd, 'dist', `gl-sdk4-ui-${view.id}.common.js.gz`),
    menuFile: resolveProjectPath(project, view.menu, `views.${view.id}.menu`),
  }));

  if (parsed.build) {
    const report = (settings.checkProject || checkProject)(cwd);
    if (!report.ok) {
      const error = new CliError('Project check failed before deploy.', EXIT_CODES.VALIDATION);
      error.details = report;
      throw error;
    }
    (settings.buildPlugin || build)({
      cwd, log, quiet: settings.quiet, json: settings.json,
    });
  }

  views.forEach((view) => {
    if (!fs.existsSync(view.gzFile) || !fs.lstatSync(view.gzFile).isFile()) {
      throw new CliError(`Build artifact not found: ${view.gzFile}\nRun "glplugin build" first.`);
    }
    if (!fs.existsSync(view.menuFile) || !fs.lstatSync(view.menuFile).isFile()) {
      throw new CliError(`Menu file not found: ${view.menu}`);
    }
  });

  const i18nDir = path.join(cwd, 'i18n');
  let i18nFiles = [];
  if (fs.existsSync(i18nDir) && fs.lstatSync(i18nDir).isDirectory()) {
    i18nFiles = fs.readdirSync(i18nDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => validateI18nFilename(
        validateRemoteFilename(entry.name), project.manifest.id
      ));
  }

  const deployPaths = currentDeployPaths(views, i18nFiles);
  const stateFile = `${DEPLOY_STATE_DIR}/${project.manifest.id}.files`;

  return withSshSession(target, (sessionOptions) => {
    let platform = null;
    if (!settings.skipPlatformCheck) {
      const inspectPlatform = settings.inspectPlatform || inspectPlatformViaSsh;
      platform = assertPlatformCompatibility(inspectPlatform(target, {
        ...sessionOptions,
        minimumFirmware: project.manifest.compatibility.minimumFirmware,
        requiredComponents: project.manifest.compatibility.requiredComponents,
      }), project.manifest, { allowUnverified: parsed.allowUnverified });
      log(
        `Platform: ${platform.compatibility.status} ` +
        `(${platform.model}, firmware ${platform.firmwareVersion})`
      );
    }
    log(`Deploying "${name}" to ${target}...`);
    if (project.manifest.profile === 'full-stack' && !settings.suppressFullStackWarning) {
      log(
        '  Warning: deploy uploads UI assets only; use glplugin package and opkg install ' +
        'to apply the full-stack overlay and lifecycle hooks.'
      );
    }

    const previousState = sshCapture(
      target,
      `cat ${stateFile} 2>/dev/null || true`,
      sessionOptions
    );
    const previousPaths = String(previousState || '')
      .split(/\r?\n/)
      .filter((remotePath) => isOwnedDeployPath(remotePath, project.manifest.id));

    log(`  Uploading ${views.length} view(s) and menu entries...`);
    views.forEach((view) => {
      scpUpload(
        target,
        view.gzFile,
        `/www/views/gl-sdk4-ui-${view.id}.common.js.gz`,
        sessionOptions
      );
      scpUpload(
        target,
        view.menuFile,
        `/usr/share/oui/menu.d/${view.id}.json`,
        sessionOptions
      );
    });

    if (i18nFiles.length) {
      log(`  Uploading i18n (${i18nFiles.length} files)...`);
      sshRun(target, 'mkdir -p /www/i18n', sessionOptions);
      i18nFiles.forEach((filename) => {
        scpUpload(
          target,
          path.join(i18nDir, filename),
          `/www/i18n/${filename}`,
          sessionOptions
        );
      });
    }

    const current = new Set(deployPaths);
    const removed = [...new Set(previousPaths)].filter((remotePath) => !current.has(remotePath));
    removed.forEach((remotePath) => sshRun(target, `rm -f ${remotePath}`, sessionOptions));

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glplugin-deploy-state-'));
    try {
      const localState = path.join(stateDir, `${project.manifest.id}.files`);
      const remoteTemporary = `${stateFile}.tmp-${process.pid}`;
      fs.writeFileSync(localState, deployPaths.join('\n') + '\n');
      sshRun(target, `mkdir -p ${DEPLOY_STATE_DIR}`, sessionOptions);
      scpUpload(target, localState, remoteTemporary, sessionOptions);
      sshRun(target, `mv -f ${remoteTemporary} ${stateFile}`, sessionOptions);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }

    log(`\nDeployed! Refresh your browser to see "${name}" in the admin panel.`);
    return {
      target,
      uploaded: views.length * 2 + i18nFiles.length,
      removed,
      compatibility: platform ? platform.compatibility : null,
    };
  }, {
    ...transportOptions,
    controlPath: settings.controlPath,
  });
};

module.exports.parseDeployArgs = parseDeployArgs;
module.exports.isOwnedDeployPath = isOwnedDeployPath;
