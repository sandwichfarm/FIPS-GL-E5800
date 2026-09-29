'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RUNTIME_CONTRACT } = require('./compatibility');
const {
  readPluginProject,
  resolveProjectPath,
  validateI18nFilename,
} = require('./manifest');
const { CliError, safeControlValue } = require('./project');

function run(command, args, options) {
  const result = spawnSync(command, args, Object.assign({ encoding: 'utf8' }, options));
  if (result.error) {
    throw new CliError(`Cannot run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new CliError(
      `${command} exited with status ${result.status}${detail ? `: ${detail}` : '.'}`
    );
  }
}

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(file);
    if (entry.isFile()) total += fs.statSync(file).size;
  }
  return total;
}

function maintainerName(author) {
  if (typeof author === 'string' && author.trim()) return author.trim();
  if (author && typeof author === 'object' && author.name) {
    return author.email ? `${author.name} <${author.email}>` : author.name;
  }
  return 'unknown';
}

function writeDefaultLifecycleScripts(controlDir) {
  const postinst = [
    '#!/bin/sh',
    '[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0',
    '[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0',
    '. ${IPKG_INSTROOT}/lib/functions.sh',
    'default_postinst $0 $@',
    '',
  ].join('\n');
  const prerm = [
    '#!/bin/sh',
    '[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0',
    '. ${IPKG_INSTROOT}/lib/functions.sh',
    'default_prerm $0 $@',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(controlDir, 'postinst'), postinst, { mode: 0o755 });
  fs.writeFileSync(path.join(controlDir, 'prerm'), prerm, { mode: 0o755 });
}

function validateFileToken(value, field, pattern) {
  const safe = safeControlValue(value, field);
  if (!pattern.test(safe)) throw new CliError(`Invalid ${field} package metadata.`);
  return safe;
}

function ensureDirectory(root, relativePath) {
  let current = root;
  for (const component of relativePath.split('/').filter(Boolean)) {
    current = path.join(current, component);
    if (fs.existsSync(current)) {
      if (!fs.lstatSync(current).isDirectory()) {
        throw new CliError(`Package data path collides with a non-directory: /${relativePath}`);
      }
    } else {
      fs.mkdirSync(current);
    }
  }
  return current;
}

function copyOverlayEntry(source, target, packagePath) {
  const sourceStat = fs.lstatSync(source);
  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);
    if (!sourceStat.isDirectory() || !targetStat.isDirectory()) {
      throw new CliError(`Overlay path collision: ${packagePath}`);
    }
  }

  if (sourceStat.isDirectory()) {
    if (!fs.existsSync(target)) fs.mkdirSync(target, { mode: sourceStat.mode & 0o777 });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyOverlayEntry(
        path.join(source, entry.name),
        path.join(target, entry.name),
        path.posix.join(packagePath, entry.name)
      );
    }
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (sourceStat.isFile()) {
    fs.copyFileSync(source, target);
    fs.chmodSync(target, sourceStat.mode & 0o777);
    return;
  }
  if (sourceStat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), target);
    return;
  }
  throw new CliError(`Unsupported overlay file type: ${packagePath}`);
}

function copyOverlay(project, dataDir) {
  if (project.manifest.profile !== 'full-stack') return;
  const overlayDir = resolveProjectPath(project, project.manifest.overlay, 'overlay');
  if (!fs.existsSync(overlayDir) || !fs.lstatSync(overlayDir).isDirectory()) {
    throw new CliError(`Overlay directory not found: ${overlayDir}`);
  }

  for (const entry of fs.readdirSync(overlayDir, { withFileTypes: true })) {
    copyOverlayEntry(
      path.join(overlayDir, entry.name),
      path.join(dataDir, entry.name),
      `/${entry.name}`
    );
  }
}

function copyLifecycleScripts(project, controlDir) {
  const targetNames = {
    preinst: 'preinst',
    postinst: 'postinst-pkg',
    prerm: 'prerm-pkg',
    postrm: 'postrm',
  };

  for (const [name, relativePath] of Object.entries(project.manifest.lifecycle)) {
    const source = resolveProjectPath(project, relativePath, `lifecycle.${name}`);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
      throw new CliError(`Lifecycle script not found: ${source}`);
    }
    const content = fs.readFileSync(source, 'utf8');
    if (!content.startsWith('#!/bin/sh\n')) {
      throw new CliError(`Lifecycle script must start with #!/bin/sh: ${relativePath}`);
    }
    run('sh', ['-n', source]);
    fs.copyFileSync(source, path.join(controlDir, targetNames[name]));
    fs.chmodSync(path.join(controlDir, targetNames[name]), 0o755);
  }
}

function writeConffiles(project, controlDir, dataDir) {
  const conffiles = project.manifest.package.conffiles;
  if (!conffiles.length) return;

  conffiles.forEach((packagePath) => {
    const target = path.resolve(dataDir, `.${packagePath}`);
    const prefix = dataDir.endsWith(path.sep) ? dataDir : dataDir + path.sep;
    if (!target.startsWith(prefix) || !fs.existsSync(target) || !fs.lstatSync(target).isFile()) {
      throw new CliError(`Conffile is not present in package data: ${packagePath}`);
    }
  });
  fs.writeFileSync(path.join(controlDir, 'conffiles'), conffiles.join('\n') + '\n');
}

module.exports = function packagePlugin(options) {
  const cwd = options && options.cwd ? path.resolve(options.cwd) : process.cwd();
  const log = options && options.log ? options.log : console.log;
  const project = readPluginProject(cwd);
  const pkg = project.pkg;
  const config = project.manifest.package;
  const name = project.manifest.id;
  const version = validateFileToken(
    pkg.version || '1.0.0',
    'Version',
    /^[A-Za-z0-9][A-Za-z0-9.+_~\-]*$/
  );
  const architecture = validateFileToken(
    config.architecture,
    'Architecture',
    /^[A-Za-z0-9][A-Za-z0-9.+_\-]*$/
  );
  const section = safeControlValue(config.section, 'Section');
  const description = safeControlValue(config.description, 'Description');
  const dependencies = config.depends;
  const views = project.manifest.views.map((view) => ({
    ...view,
    gzFile: path.join(cwd, 'dist', `gl-sdk4-ui-${view.id}.common.js.gz`),
    menuFile: resolveProjectPath(project, view.menu, `views.${view.id}.menu`),
  }));
  views.forEach((view) => {
    if (!fs.existsSync(view.gzFile)) {
      throw new CliError(`Build artifact not found: ${view.gzFile}\nRun "glplugin build" first.`);
    }
    if (!fs.existsSync(view.menuFile)) {
      throw new CliError(`Menu file not found: ${view.menu}`);
    }
  });

  const ipkName = validateFileToken(
    config.name,
    'Package',
    /^[a-z0-9][a-z0-9+._-]*$/
  );
  const distDir = path.join(cwd, 'dist');
  const ipkFile = path.join(distDir, `${ipkName}_${version}_${architecture}.ipk`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glplugin-ipk-'));
  const dataDir = path.join(tmpDir, 'data');
  const controlDir = path.join(tmpDir, 'control');

  log(`Packaging "${name}" as .ipk...`);

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    copyOverlay(project, dataDir);

    const viewsDir = ensureDirectory(dataDir, 'www/views');
    const menuDir = ensureDirectory(dataDir, 'usr/share/oui/menu.d');
    views.forEach((view) => {
      const viewTarget = path.join(viewsDir, `gl-sdk4-ui-${view.id}.common.js.gz`);
      const menuTarget = path.join(menuDir, `${view.id}.json`);
      if (fs.existsSync(viewTarget)) {
        throw new CliError(`Overlay path collision: /www/views/${path.basename(viewTarget)}`);
      }
      if (fs.existsSync(menuTarget)) {
        throw new CliError(`Overlay path collision: /usr/share/oui/menu.d/${path.basename(menuTarget)}`);
      }
      fs.copyFileSync(view.gzFile, viewTarget);
      fs.copyFileSync(view.menuFile, menuTarget);
    });

    const i18nDir = path.join(cwd, 'i18n');
    if (fs.existsSync(i18nDir)) {
      const files = fs.readdirSync(i18nDir, { withFileTypes: true }).filter(function(entry) {
        return entry.isFile() && entry.name.endsWith('.json');
      });
      files.forEach((entry) => validateI18nFilename(entry.name, project.manifest.id));
      if (files.length) {
        const targetDir = ensureDirectory(dataDir, 'www/i18n');
        files.forEach(function(entry) {
          const target = path.join(targetDir, entry.name);
          if (fs.existsSync(target)) {
            throw new CliError(`Overlay path collision: /www/i18n/${entry.name}`);
          }
          fs.copyFileSync(path.join(i18nDir, entry.name), target);
        });
      }
    }

    fs.mkdirSync(controlDir, { recursive: true });
    const control = [
      `Package: ${ipkName}`,
      `Version: ${version}`,
      dependencies.length ? `Depends: ${dependencies.join(', ')}` : null,
      `Source: ${safeControlValue(config.source, 'Source')}`,
      `SourceName: ${ipkName}`,
      `Section: ${section}`,
      `Architecture: ${architecture}`,
      `X-GL-Firmware-Min: ${safeControlValue(
        project.manifest.compatibility.minimumFirmware, 'X-GL-Firmware-Min'
      )}`,
      `X-GL-UI-Contract: ${RUNTIME_CONTRACT}`,
      project.manifest.compatibility.requiredCapabilities.length
        ? `X-GL-RPC-Capabilities: ${project.manifest.compatibility.requiredCapabilities.join(',')}`
        : null,
      `Installed-Size: ${directorySize(dataDir)}`,
      `Maintainer: ${safeControlValue(maintainerName(pkg.author), 'Maintainer')}`,
      `Description: ${description}`,
      '',
    ].filter(function(line) { return line !== null; }).join('\n');
    fs.writeFileSync(path.join(controlDir, 'control'), control);
    writeDefaultLifecycleScripts(controlDir);
    copyLifecycleScripts(project, controlDir);
    writeConffiles(project, controlDir, dataDir);
    fs.writeFileSync(path.join(tmpDir, 'debian-binary'), '2.0\n');

    const tarEnvironment = Object.assign({}, process.env, { COPYFILE_DISABLE: '1' });
    const tarArgs = ['--format', 'ustar', '--numeric-owner', '--group=0', '--owner=0', '-czf'];
    run('tar', tarArgs.concat(path.join(tmpDir, 'data.tar.gz'), '.'), {
      cwd: dataDir,
      env: tarEnvironment,
    });
    run('tar', tarArgs.concat(path.join(tmpDir, 'control.tar.gz'), '.'), {
      cwd: controlDir,
      env: tarEnvironment,
    });

    fs.mkdirSync(distDir, { recursive: true });
    run(
      'tar',
      tarArgs.concat(ipkFile, 'debian-binary', 'control.tar.gz', 'data.tar.gz'),
      { cwd: tmpDir, env: tarEnvironment }
    );

    const stats = fs.statSync(ipkFile);
    log(`
  Package created: ${path.relative(cwd, ipkFile)} (${(stats.size / 1024).toFixed(1)} KB)

  Inspect: glplugin inspect ${path.relative(cwd, ipkFile)}
  Install: glplugin install --no-build
    `);

    return { architecture, ipkFile, packageName: ipkName, profile: project.manifest.profile };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

module.exports.directorySize = directorySize;
module.exports.copyOverlay = copyOverlay;
