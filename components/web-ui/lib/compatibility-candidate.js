'use strict';

const fs = require('fs');
const path = require('path');
const {
  MINIMUM_FIRMWARE,
  RUNTIME_CONTRACT,
  analyzeAdminBundle,
  compareFirmwareVersions,
  parseFirmwareVersion,
} = require('./compatibility');
const {
  PORTABLE_COMPONENTS,
  canonicalModel,
  findFirmwareByBundle,
  normalizedFirmware,
} = require('./firmware-catalog');
const { CliError, EXIT_CODES } = require('./project');

const KIND = 'gl-sdk4-compatibility-candidate';
const ACCEPTED_EVIDENCE_STATUSES = new Set([
  'unverified', 'artifact-verified', 'live-supported',
]);

function validationError(message) {
  return new CliError(message, EXIT_CODES.VALIDATION);
}

function doctorDetails(value) {
  if (value && value.result && value.result.router && value.result.compatibility) {
    return value.result;
  }
  if (value && value.error && value.error.details &&
      value.error.details.router && value.error.details.compatibility) {
    return value.error.details;
  }
  if (value && value.router && value.compatibility) return value;
  throw validationError('Input is not a glplugin doctor JSON report.');
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function captureCandidate(input) {
  const report = doctorDetails(input);
  const router = report.router || {};
  const compatibility = report.compatibility || {};
  const firmware = normalizedFirmware(
    compatibility.firmware || router.firmware_version
  );
  const components = Array.isArray(compatibility.staticPortableComponents)
    ? [...new Set(compatibility.staticPortableComponents.filter((item) => typeof item === 'string'))]
    : [];

  return {
    schemaVersion: 1,
    kind: KIND,
    capturedAt: text(report.checked_at),
    router: {
      model: canonicalModel(compatibility.model || router.model),
      firmware,
      firmwareType: text(router.firmware_type),
      architecture: text(router.architecture),
      openwrtVersion: text(router.openwrt_version),
    },
    runtime: {
      contract: text(compatibility.runtimeContract),
      bundleSha256: text(compatibility.bundleSha256).toLowerCase(),
      componentEvidence: 'unverified-static-signals',
      staticPortableComponents: components,
    },
    evidence: {
      source: text(compatibility.source),
      compatibilityStatus: text(compatibility.status),
    },
  };
}

function issue(errors, id, message) {
  errors.push({ id, message });
}

function verifyCandidate(candidate, options) {
  const settings = options || {};
  const value = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate
    : {};
  const router = value.router && typeof value.router === 'object' ? value.router : {};
  const runtime = value.runtime && typeof value.runtime === 'object' ? value.runtime : {};
  const evidence = value.evidence && typeof value.evidence === 'object' ? value.evidence : {};
  const errors = [];

  if (value.schemaVersion !== 1 || value.kind !== KIND) {
    issue(errors, 'schema', `Candidate must use schemaVersion 1 and kind "${KIND}".`);
  }

  const model = canonicalModel(router.model);
  if (!/^GL-[A-Z0-9]+$/.test(model)) {
    issue(errors, 'model', 'Router model must contain a canonical GL-* model identifier.');
  }

  const firmware = parseFirmwareVersion(router.firmware);
  if (!firmware) {
    issue(errors, 'minimum-firmware', 'Firmware must contain a numeric major.minor version.');
  } else if (compareFirmwareVersions(firmware, MINIMUM_FIRMWARE) < 0) {
    issue(
      errors,
      'minimum-firmware',
      `Firmware ${firmware.normalized} is older than required ${MINIMUM_FIRMWARE}.`
    );
  }

  if (runtime.contract !== RUNTIME_CONTRACT) {
    issue(errors, 'runtime-contract', `Runtime contract must be ${RUNTIME_CONTRACT}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(runtime.bundleSha256 || '')) {
    issue(errors, 'bundle-sha256', 'Admin bundle SHA-256 must contain 64 lowercase hex characters.');
  }

  if (runtime.componentEvidence !== 'unverified-static-signals') {
    issue(
      errors,
      'component-evidence',
      'Candidate component evidence must be marked unverified-static-signals.'
    );
  }
  const components = Array.isArray(runtime.staticPortableComponents)
    ? runtime.staticPortableComponents
    : [];
  const missingComponents = PORTABLE_COMPONENTS.filter((name) => !components.includes(name));
  if (missingComponents.length) {
    issue(
      errors,
      'static-portable-components',
      `Missing static portable component signal(s): ${missingComponents.join(', ')}.`
    );
  }

  let bundleAnalysis = null;
  if (!settings.bundle) {
    issue(errors, 'bundle-evidence', 'Admin bundle evidence is required.');
  } else {
    try {
      bundleAnalysis = (settings.analyzeAdminBundle || analyzeAdminBundle)(settings.bundle);
      if (bundleAnalysis.bundleSha256 !== runtime.bundleSha256) {
        issue(errors, 'bundle-match', 'Admin bundle SHA-256 does not match the candidate.');
      }
      const missingContracts = ['viewLoader', 'rpcRequest'].filter(
        (name) => !bundleAnalysis.contracts || bundleAnalysis.contracts[name] !== true
      );
      if (missingContracts.length) {
        issue(
          errors,
          'bundle-contract',
          `Admin bundle is missing contract(s): ${missingContracts.join(', ')}.`
        );
      }
      const missingSignals = PORTABLE_COMPONENTS.filter((name) => (
        !bundleAnalysis.staticPortableComponents ||
        !bundleAnalysis.staticPortableComponents.includes(name)
      ));
      if (missingSignals.length) {
        issue(
          errors,
          'bundle-components',
          `Admin bundle is missing static component signal(s): ${missingSignals.join(', ')}.`
        );
      }
    } catch (error) {
      issue(errors, 'bundle-evidence', `Cannot analyze admin bundle: ${error.message}`);
    }
  }

  if (evidence.source !== 'http-admin-bundle') {
    issue(errors, 'evidence-source', 'Evidence source must be http-admin-bundle.');
  }
  if (!ACCEPTED_EVIDENCE_STATUSES.has(evidence.compatibilityStatus)) {
    issue(
      errors,
      'evidence-status',
      'Evidence status must be unverified, artifact-verified, or live-supported.'
    );
  }

  if (errors.length) {
    return { ready: false, status: 'invalid', errors, catalogMatch: null };
  }

  const catalogEntry = findFirmwareByBundle(runtime.bundleSha256, {
    model,
    firmware: firmware.normalized,
  });
  return {
    ready: true,
    status: catalogEntry ? 'already-supported' : 'ready-for-review',
    errors: [],
    catalogMatch: catalogEntry ? {
      id: catalogEntry.id,
      validation: catalogEntry.validation,
    } : null,
  };
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw validationError(`Cannot read ${label}: ${error.message}`);
  }
}

function writeJsonAtomic(file, value) {
  if (!fs.existsSync(path.dirname(file))) {
    throw validationError(`Output directory does not exist: ${path.dirname(file)}`);
  }
  if (fs.existsSync(file)) {
    throw validationError(`Refusing to overwrite existing file: ${file}`);
  }
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

function readOptionValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new CliError(`${option} requires a value.`, EXIT_CODES.USAGE);
  }
  return value;
}

function parseCaptureArgs(args) {
  const parsed = { input: '', output: 'compatibility-candidate.json' };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--output') {
      parsed.output = readOptionValue(args, index, value);
      index += 1;
    } else if (value.startsWith('-')) {
      throw new CliError(`Unknown compatibility capture option: ${value}`, EXIT_CODES.USAGE);
    } else if (!parsed.input) parsed.input = value;
    else throw new CliError(
      'Usage: glplugin compatibility capture <doctor.json> [--output <candidate.json>]',
      EXIT_CODES.USAGE
    );
  }
  if (!parsed.input) {
    throw new CliError(
      'Usage: glplugin compatibility capture <doctor.json> [--output <candidate.json>]',
      EXIT_CODES.USAGE
    );
  }
  return parsed;
}

function parseVerifyArgs(args) {
  const parsed = { input: '', bundle: '' };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--bundle') {
      parsed.bundle = readOptionValue(args, index, value);
      index += 1;
    } else if (value.startsWith('-')) {
      throw new CliError(`Unknown compatibility verify option: ${value}`, EXIT_CODES.USAGE);
    } else if (!parsed.input) parsed.input = value;
    else throw new CliError(
      'Usage: glplugin compatibility verify <candidate.json> --bundle <app.js[.gz]>',
      EXIT_CODES.USAGE
    );
  }
  if (!parsed.input || !parsed.bundle) {
    throw new CliError(
      'Usage: glplugin compatibility verify <candidate.json> --bundle <app.js[.gz]>',
      EXIT_CODES.USAGE
    );
  }
  return parsed;
}

function compatibilityCli(args, options) {
  const action = args[0];
  const rest = args.slice(1);
  if (action === 'capture') {
    const parsed = parseCaptureArgs(rest);
    const inputFile = path.resolve(options.cwd, parsed.input);
    const outFile = path.resolve(options.cwd, parsed.output);
    const candidate = captureCandidate(readJson(inputFile, 'doctor report'));
    writeJsonAtomic(outFile, candidate);
    if (!options.json) options.log(`Compatibility candidate saved to ${outFile}.`);
    return { outFile, candidate };
  }
  if (action === 'verify') {
    const parsed = parseVerifyArgs(rest);
    const inputFile = path.resolve(options.cwd, parsed.input);
    const bundleFile = path.resolve(options.cwd, parsed.bundle);
    let bundle;
    try {
      bundle = fs.readFileSync(bundleFile);
    } catch (error) {
      throw validationError(`Cannot read admin bundle: ${error.message}`);
    }
    const result = verifyCandidate(readJson(inputFile, 'compatibility candidate'), { bundle });
    if (!result.ready) {
      const error = validationError('Compatibility candidate verification failed.');
      error.details = result;
      throw error;
    }
    if (!options.json) options.log(`Compatibility candidate: ${result.status}.`);
    return result;
  }
  throw new CliError(
    'Usage: glplugin compatibility <capture|verify> [arguments]',
    EXIT_CODES.USAGE
  );
}

module.exports = {
  KIND,
  captureCandidate,
  cli: compatibilityCli,
  parseCaptureArgs,
  parseVerifyArgs,
  verifyCandidate,
};
