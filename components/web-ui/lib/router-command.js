'use strict';

const { CliError, EXIT_CODES } = require('./project');

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError(`${flag} requires a value.`, EXIT_CODES.USAGE);
  }
  return value;
}

function parseRouterArgs(args, options) {
  const settings = options || {};
  const parsed = {
    host: '',
    username: 'root',
    https: false,
    insecure: false,
    allowUnverified: false,
    json: false,
    passwordStdin: false,
  };
  const provided = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--username') {
      parsed.username = readValue(args, index, '--username');
      provided.add('username');
      index += 1;
    } else if (argument.startsWith('--username=')) {
      parsed.username = argument.slice('--username='.length);
      provided.add('username');
    } else if (argument === '--https') {
      parsed.https = true;
      provided.add('https');
    } else if (argument === '--http') {
      parsed.https = false;
      provided.add('https');
    } else if (argument === '--insecure') {
      parsed.insecure = true;
      provided.add('insecure');
    } else if (argument === '--secure') {
      parsed.insecure = false;
      provided.add('insecure');
    } else if (argument === '--password-stdin') {
      parsed.passwordStdin = true;
    } else if (argument === '--allow-unverified' && settings.allowUnverified) {
      parsed.allowUnverified = true;
    } else if (argument === '--json' && settings.allowJson) {
      parsed.json = true;
    } else if (argument.startsWith('-')) {
      throw new CliError(`Unknown option: ${argument}`, EXIT_CODES.USAGE);
    } else if (!parsed.host) {
      parsed.host = argument;
    } else {
      throw new CliError(
        'Passwords and extra positional arguments are not accepted.',
        EXIT_CODES.USAGE
      );
    }
  }

  if (!parsed.host && !settings.allowMissingHost) {
    throw new CliError(settings.usage || 'Router host is required.', EXIT_CODES.USAGE);
  }
  if (!parsed.username) {
    throw new CliError('Router username must not be empty.', EXIT_CODES.USAGE);
  }
  Object.defineProperty(parsed, 'provided', { enumerable: false, value: provided });
  return parsed;
}

function applyRouterTarget(parsed, target) {
  const provided = parsed.provided || new Set();
  return {
    ...parsed,
    host: target.rpcHost,
    username: provided.has('username') ? parsed.username : target.username,
    https: provided.has('https') ? parsed.https : target.https,
    insecure: provided.has('insecure') ? parsed.insecure : target.insecure,
  };
}

function authOptions(parsed) {
  return {
    https: parsed.https,
    insecure: parsed.insecure,
  };
}

module.exports = { applyRouterTarget, authOptions, parseRouterArgs };
