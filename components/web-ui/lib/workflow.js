'use strict';

const path = require('path');
const build = require('./build');
const { checkProject } = require('./check');
const packagePlugin = require('./package');
const { readPluginProject } = require('./manifest');
const { CliError, EXIT_CODES } = require('./project');
const { assertPlatformCompatibility, inspectPlatformViaSsh } = require('./platform');
const {
  scpUpload, sshRun, validateRemoteFilename, withSshSession,
} = require('./ssh-transport');

function parseWorkflowArgs(args, options) {
  const settings = options || {};
  const parsed = { target: '', build: true, hostKeyPolicy: null, allowUnverified: false };
  args.forEach((value) => {
    if (value === '--no-build' && settings.allowNoBuild) parsed.build = false;
    else if (value === '--allow-unverified' && settings.allowUnverified) {
      parsed.allowUnverified = true;
    }
    else if (value === '--insecure-host-key') parsed.hostKeyPolicy = 'insecure';
    else if (value === '--strict-host-key') parsed.hostKeyPolicy = 'strict';
    else if (value.startsWith('-')) throw new CliError(`Unknown option: ${value}`, EXIT_CODES.USAGE);
    else if (!parsed.target) parsed.target = value;
    else throw new CliError(settings.usage, EXIT_CODES.USAGE);
  });
  return parsed;
}

function insecureHostKey(parsed, target) {
  if (parsed.hostKeyPolicy === 'insecure') return true;
  if (parsed.hostKeyPolicy === 'strict') return false;
  return target.insecureHostKey;
}

function validatePackageToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9+._-]*$/.test(value)) {
    throw new CliError('Unsafe package name.', EXIT_CODES.VALIDATION);
  }
  return value;
}

function installPlugin(options) {
  const settings = options || {};
  const cwd = path.resolve(settings.cwd || process.cwd());
  const log = settings.log || console.log;
  const buildPlugin = settings.buildPlugin || build;
  const createPackage = settings.packagePlugin || packagePlugin;
  const project = readPluginProject(cwd);
  if (settings.build !== false) {
    const report = (settings.checkProject || checkProject)(cwd);
    if (!report.ok) {
      const error = new CliError('Project check failed before install.', EXIT_CODES.VALIDATION);
      error.details = report;
      throw error;
    }
    buildPlugin({ cwd, log, quiet: settings.quiet, json: settings.json });
  }
  const packaged = createPackage({ cwd, log, quiet: settings.quiet, json: settings.json });
  const filename = validateRemoteFilename(path.basename(packaged.ipkFile));
  const remotePath = `/tmp/${filename}`;
  return withSshSession(settings.target.ssh, (sessionOptions) => {
    let platform = null;
    if (!settings.skipPlatformCheck) {
      const inspectPlatform = settings.inspectPlatform || inspectPlatformViaSsh;
      platform = assertPlatformCompatibility(inspectPlatform(settings.target.ssh, {
        ...sessionOptions,
        minimumFirmware: project.manifest.compatibility.minimumFirmware,
        requiredComponents: project.manifest.compatibility.requiredComponents,
      }), project.manifest, {
        allowUnverified: settings.allowUnverified,
      });
      log(
        `Platform: ${platform.compatibility.status} ` +
        `(${platform.model}, firmware ${platform.firmwareVersion})`
      );
    }
    log(`Uploading ${filename} to ${settings.target.ssh}...`);
    scpUpload(settings.target.ssh, packaged.ipkFile, remotePath, sessionOptions);
    log(`Installing ${packaged.packageName}...`);
    const reinstallFlag = settings.forceReinstall ? '--force-reinstall ' : '';
    sshRun(
      settings.target.ssh,
      `opkg install ${reinstallFlag}${remotePath}; ` +
      `status=$?; rm -f ${remotePath}; exit "$status"`,
      sessionOptions
    );
    log(`Installed ${packaged.packageName} on ${settings.target.ssh}.`);
    return {
      target: settings.target.ssh,
      packageName: packaged.packageName,
      ipkFile: packaged.ipkFile,
      remotePath,
      built: settings.build !== false,
      compatibility: platform ? platform.compatibility : null,
    };
  }, settings);
}

function uninstallPlugin(options) {
  const settings = options || {};
  const cwd = path.resolve(settings.cwd || process.cwd());
  const log = settings.log || console.log;
  const project = readPluginProject(cwd);
  const packageName = validatePackageToken(project.manifest.package.name);
  log(`Removing ${packageName} from ${settings.target.ssh}...`);
  sshRun(settings.target.ssh, `opkg remove ${packageName}`, settings);
  log(`Removed ${packageName}.`);
  return { target: settings.target.ssh, packageName };
}

function installCli(args, options) {
  const parsed = parseWorkflowArgs(args, {
    allowNoBuild: true,
    allowUnverified: true,
    usage: 'Usage: glplugin install [target|host] [--no-build] [--insecure-host-key] [--allow-unverified]',
  });
  const target = options.resolveTarget(parsed.target);
  return installPlugin({
    cwd: options.cwd,
    log: options.log,
    target,
    build: parsed.build,
    insecureHostKey: insecureHostKey(parsed, target),
    quiet: options.quiet || options.json,
    json: options.json,
    allowUnverified: parsed.allowUnverified,
  });
}

function uninstallCli(args, options) {
  const parsed = parseWorkflowArgs(args, {
    usage: 'Usage: glplugin uninstall [target|host] [--insecure-host-key]',
  });
  const target = options.resolveTarget(parsed.target);
  return uninstallPlugin({
    cwd: options.cwd,
    log: options.log,
    target,
    insecureHostKey: insecureHostKey(parsed, target),
    quiet: options.quiet || options.json,
    json: options.json,
  });
}

module.exports = {
  installCli,
  installPlugin,
  parseWorkflowArgs,
  uninstallCli,
  uninstallPlugin,
  validatePackageToken,
};
