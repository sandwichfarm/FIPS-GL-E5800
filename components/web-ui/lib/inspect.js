'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CliError, EXIT_CODES } = require('./project');

const MAX_OUTPUT = 16 * 1024 * 1024;

function runTar(args, options) {
  const settings = options || {};
  const result = (settings.spawnSync || spawnSync)('tar', args, {
    encoding: settings.encoding || 'utf8', maxBuffer: MAX_OUTPUT, shell: false,
  });
  if (result.error) throw new CliError(`Cannot run tar: ${result.error.message}`);
  if (result.status !== 0) {
    throw new CliError(`tar exited with status ${result.status}: ${String(result.stderr).trim()}`);
  }
  return result.stdout;
}

function normalizeArchiveEntry(entry) {
  const value = entry.replace(/^\.\//, '').replace(/\/$/, '');
  if (!value || value === '.') return '';
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value ||
      value === '..' || value.startsWith('../') || value.includes('\\')) {
    throw new CliError(`Unsafe archive path: ${entry}`, EXIT_CODES.VALIDATION);
  }
  return value;
}

function listArchive(archive, options) {
  return runTar(['-tzf', archive], options)
    .split('\n')
    .filter(Boolean)
    .map(normalizeArchiveEntry)
    .filter(Boolean);
}

function readArchiveEntry(archive, name, options) {
  let firstError;
  for (const candidate of [`./${name}`, name]) {
    try {
      return runTar(['-xOzf', archive, candidate], options);
    } catch (error) {
      firstError = firstError || error;
    }
  }
  throw firstError;
}

function selectEntry(entries, name) {
  const match = entries.find((entry) => entry === name);
  if (!match) throw new CliError(`Package archive is missing ${name}.`, EXIT_CODES.VALIDATION);
  return match;
}

function parseControl(content) {
  const metadata = {};
  let current = null;
  content.split(/\r?\n/).forEach((line) => {
    if (/^[ \t]/.test(line) && current) {
      metadata[current] += `\n${line.slice(1)}`;
      return;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      current = match[1];
      metadata[current] = match[2];
    }
  });
  return metadata;
}

function inspectPackage(file, options) {
  const settings = options || {};
  const archive = path.resolve(file);
  if (!fs.existsSync(archive) || !fs.statSync(archive).isFile()) {
    throw new CliError(`Package not found: ${archive}`, EXIT_CODES.USAGE);
  }
  const outerEntries = listArchive(archive, settings);
  ['debian-binary', 'control.tar.gz', 'data.tar.gz'].forEach((name) => selectEntry(outerEntries, name));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'glplugin-inspect-'));
  try {
    const version = readArchiveEntry(archive, 'debian-binary', settings).trim();
    if (version !== '2.0') {
      throw new CliError(`Unsupported package format version: ${version}`, EXIT_CODES.VALIDATION);
    }
    const controlArchive = path.join(temporary, 'control.tar.gz');
    const dataArchive = path.join(temporary, 'data.tar.gz');
    fs.writeFileSync(controlArchive, readArchiveEntry(archive, 'control.tar.gz', {
      ...settings, encoding: 'buffer',
    }));
    fs.writeFileSync(dataArchive, readArchiveEntry(archive, 'data.tar.gz', {
      ...settings, encoding: 'buffer',
    }));
    const controlFiles = listArchive(controlArchive, settings);
    const dataFiles = listArchive(dataArchive, settings);
    const controlName = selectEntry(controlFiles, 'control');
    const control = readArchiveEntry(controlArchive, controlName, settings);
    const metadata = parseControl(control);
    const scripts = controlFiles.filter((name) =>
      ['preinst', 'postinst', 'postinst-pkg', 'prerm', 'prerm-pkg', 'postrm'].includes(name)
    );
    const viewFiles = dataFiles.filter((name) => /^www\/views\/.*\.common\.js\.gz$/.test(name));
    const menuFiles = dataFiles.filter((name) => /^usr\/share\/oui\/menu\.d\/.*\.json$/.test(name));
    const report = {
      ok: Boolean(metadata.Package && metadata.Version && viewFiles.length && menuFiles.length),
      file: archive,
      size: fs.statSync(archive).size,
      formatVersion: version,
      metadata,
      scripts,
      conffiles: controlFiles.includes('conffiles')
        ? readArchiveEntry(controlArchive, 'conffiles', settings).trim().split('\n').filter(Boolean)
        : [],
      controlFiles,
      dataFiles,
      summary: {
        controlFileCount: controlFiles.length,
        dataFileCount: dataFiles.length,
        viewFiles,
        menuFiles,
      },
    };
    if (!report.ok) {
      throw new CliError('Package is missing required metadata, view, or menu files.', EXIT_CODES.VALIDATION);
    }
    return report;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function inspectCli(args, options) {
  if (args.length !== 1) {
    throw new CliError('Usage: glplugin inspect <package.ipk>', EXIT_CODES.USAGE);
  }
  const report = inspectPackage(path.resolve(options && options.cwd || process.cwd(), args[0]), options);
  const log = options && options.log ? options.log : console.log;
  if (!(options && options.json)) {
    log(`${report.metadata.Package} ${report.metadata.Version} (${report.metadata.Architecture})`);
    log(`  Depends: ${report.metadata.Depends || 'none'}`);
    log(`  Data files: ${report.summary.dataFileCount}`);
    log(`  Lifecycle scripts: ${report.scripts.length ? report.scripts.join(', ') : 'none'}`);
    log(`  Conffiles: ${report.conffiles.length ? report.conffiles.join(', ') : 'none'}`);
  }
  return report;
}

module.exports = {
  cli: inspectCli,
  inspectPackage,
  listArchive,
  normalizeArchiveEntry,
  parseControl,
  readArchiveEntry,
};
