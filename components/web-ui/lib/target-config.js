'use strict';

const fs = require('fs');
const path = require('path');
const { CliError, EXIT_CODES } = require('./project');
const { normalizeSshTarget } = require('./ssh-transport');

const TARGET_CONFIG_FILE = '.glpluginrc.json';
const TARGET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TARGET_KEYS = new Set([
  'ssh', 'rpcHost', 'username', 'https', 'insecure', 'insecureHostKey',
]);

function configPath(cwd) {
  return path.join(path.resolve(cwd || process.cwd()), TARGET_CONFIG_FILE);
}

function emptyConfig() {
  return { version: 1, current: null, targets: {} };
}

function validateTargetName(name) {
  if (typeof name !== 'string' || !TARGET_NAME_PATTERN.test(name)) {
    throw new CliError(
      'Target name must use letters, numbers, underscores, or hyphens.',
      EXIT_CODES.USAGE
    );
  }
  return name;
}

function normalizeTarget(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError(`Target "${label}" must be an object.`, EXIT_CODES.VALIDATION);
  }
  const unknown = Object.keys(value).filter((key) => !TARGET_KEYS.has(key));
  if (unknown.length) {
    throw new CliError(
      `Unknown target field for "${label}": ${unknown[0]}`,
      EXIT_CODES.VALIDATION
    );
  }

  const ssh = normalizeSshTarget(value.ssh);
  const rpcHost = value.rpcHost === undefined ? ssh.host : normalizeSshTarget(value.rpcHost).host;
  const username = value.username === undefined ? ssh.user : String(value.username);
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    throw new CliError(`Invalid RPC username for target "${label}".`, EXIT_CODES.VALIDATION);
  }
  ['https', 'insecure', 'insecureHostKey'].forEach((field) => {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') {
      throw new CliError(
        `Target "${label}" field "${field}" must be boolean.`,
        EXIT_CODES.VALIDATION
      );
    }
  });

  return {
    ssh: ssh.target,
    rpcHost,
    username,
    https: value.https === true,
    insecure: value.insecure === true,
    insecureHostKey: value.insecureHostKey === true,
  };
}

function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError(`${TARGET_CONFIG_FILE} must contain an object.`, EXIT_CODES.VALIDATION);
  }
  const unknown = Object.keys(value).filter((key) => !['version', 'current', 'targets'].includes(key));
  if (unknown.length) {
    throw new CliError(`Unknown ${TARGET_CONFIG_FILE} field: ${unknown[0]}`, EXIT_CODES.VALIDATION);
  }
  if (value.version !== 1) {
    throw new CliError(`${TARGET_CONFIG_FILE} version must be 1.`, EXIT_CODES.VALIDATION);
  }
  if (!value.targets || typeof value.targets !== 'object' || Array.isArray(value.targets)) {
    throw new CliError(`${TARGET_CONFIG_FILE} targets must be an object.`, EXIT_CODES.VALIDATION);
  }

  const targets = {};
  Object.entries(value.targets).forEach(([name, target]) => {
    validateTargetName(name);
    targets[name] = normalizeTarget(target, name);
  });
  const current = value.current == null ? null : validateTargetName(value.current);
  if (current && !targets[current]) {
    throw new CliError(`Current target "${current}" does not exist.`, EXIT_CODES.VALIDATION);
  }
  return { version: 1, current, targets };
}

function readTargetConfig(cwd, options) {
  const file = configPath(cwd);
  if (!fs.existsSync(file)) return emptyConfig();
  try {
    return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`Cannot parse ${file}: ${error.message}`, EXIT_CODES.VALIDATION);
  }
}

function writeTargetConfig(cwd, value) {
  const config = validateConfig(value);
  const file = configPath(cwd);
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
  return config;
}

function addTarget(cwd, name, sshValue, options) {
  const settings = options || {};
  validateTargetName(name);
  const config = readTargetConfig(cwd);
  if (config.targets[name] && !settings.force) {
    throw new CliError(`Target "${name}" already exists. Use --force to replace it.`);
  }
  config.targets[name] = normalizeTarget({
    ssh: sshValue,
    rpcHost: settings.rpcHost,
    username: settings.username,
    https: settings.https,
    insecure: settings.insecure,
    insecureHostKey: settings.insecureHostKey,
  }, name);
  if (!config.current || settings.use) config.current = name;
  writeTargetConfig(cwd, config);
  return { name, current: config.current === name, ...config.targets[name] };
}

function useTarget(cwd, name) {
  const config = readTargetConfig(cwd);
  validateTargetName(name);
  if (!config.targets[name]) throw new CliError(`Unknown target: ${name}`, EXIT_CODES.USAGE);
  config.current = name;
  writeTargetConfig(cwd, config);
  return { name, ...config.targets[name] };
}

function removeTarget(cwd, name) {
  const config = readTargetConfig(cwd);
  validateTargetName(name);
  if (!config.targets[name]) throw new CliError(`Unknown target: ${name}`, EXIT_CODES.USAGE);
  delete config.targets[name];
  if (config.current === name) config.current = Object.keys(config.targets).sort()[0] || null;
  writeTargetConfig(cwd, config);
  return { removed: name, current: config.current };
}

function listTargets(cwd) {
  const config = readTargetConfig(cwd);
  return Object.keys(config.targets).sort().map((name) => ({
    name,
    current: config.current === name,
    ...config.targets[name],
  }));
}

function rawTarget(value) {
  const ssh = normalizeSshTarget(value);
  return normalizeTarget({ ssh: ssh.target }, 'command line');
}

function resolveTarget(value, options) {
  const settings = options || {};
  const config = readTargetConfig(settings.cwd);
  if (value && config.targets[value]) {
    return { name: value, source: 'config', ...config.targets[value] };
  }
  if (value) return { name: null, source: 'argument', ...rawTarget(value) };

  const envHost = (settings.env || process.env).GLPLUGIN_HOST;
  if (envHost) return { name: null, source: 'environment', ...rawTarget(envHost) };
  if (config.current) {
    return { name: config.current, source: 'config', ...config.targets[config.current] };
  }
  throw new CliError(
    'Router target required. Pass a host, set GLPLUGIN_HOST, or run "glplugin target add".',
    EXIT_CODES.USAGE
  );
}

module.exports = {
  TARGET_CONFIG_FILE,
  addTarget,
  configPath,
  emptyConfig,
  listTargets,
  normalizeTarget,
  readTargetConfig,
  removeTarget,
  resolveTarget,
  useTarget,
  validateConfig,
  validateTargetName,
  writeTargetConfig,
};
