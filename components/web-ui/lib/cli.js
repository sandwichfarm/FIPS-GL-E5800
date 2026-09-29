'use strict';

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const { CliError, EXIT_CODES } = require('./project');
const targets = require('./target-config');

const COMMAND_HELP = Object.freeze({
  init: 'glplugin init <name> [--profile ui-only|full-stack] [--install]',
  build: 'glplugin build',
  package: 'glplugin package',
  check: 'glplugin check [--strict]',
  capabilities: 'glplugin capabilities',
  compatibility: 'glplugin compatibility <capture|verify> [arguments]',
  view: 'glplugin view <add|list|remove> [arguments]',
  inspect: 'glplugin inspect <package.ipk>',
  deploy: 'glplugin deploy [target|host] [--build] [--insecure-host-key] [--allow-unverified]',
  install: 'glplugin install [target|host] [--no-build] [--insecure-host-key] [--allow-unverified]',
  uninstall: 'glplugin uninstall [target|host] [--insecure-host-key]',
  dev: 'glplugin dev [target|host] [--debounce <ms>] [--insecure-host-key] [--allow-unverified]',
  doctor: 'glplugin doctor [target|host] [--https|--http] [--insecure|--secure] [--username <name>] [--password-stdin] [--allow-unverified]',
  test: 'glplugin test [target|host] [--https|--http] [--insecure|--secure] [--username <name>] [--password-stdin] [--allow-unverified]',
  extract: 'glplugin extract [target|host] [--rpc|--full] [--password-stdin] [--include-sensitive] [--insecure-host-key]',
  target: 'glplugin target <add|list|show|use|remove> [arguments]',
});

const TARGET_HELP = Object.freeze({
  add: 'glplugin target add <name> <[user@]host> [--rpc-host <host>] [--username <name>] [--https] [--insecure] [--insecure-host-key] [--use] [--force]',
  list: 'glplugin target list',
  show: 'glplugin target show [name]',
  use: 'glplugin target use <name>',
  remove: 'glplugin target remove <name>',
});

const VIEW_HELP = Object.freeze({
  add: 'glplugin view add <id> [--title <text>] [--parent <view>|--top-level] [--entry <path>] [--menu <path>] [--icon <name>] [--index <number>]',
  list: 'glplugin view list',
  remove: 'glplugin view remove <id> [--delete-files]',
});

const COMPATIBILITY_HELP = Object.freeze({
  capture: 'glplugin compatibility capture <doctor.json> [--output <candidate.json>]',
  verify: 'glplugin compatibility verify <candidate.json> --bundle <app.js[.gz]>',
});

const MAIN_HELP = `
gl-sdk4-plugin-kit - Build, validate, and install GL.iNet SDK4 plugins

Usage:
  glplugin <command> [options]

Project:
  init       Scaffold a ui-only or full-stack plugin
  view       Add, list, or remove plugin pages
  compatibility  Capture or verify firmware evidence
  check      Validate project files and local toolchain
  capabilities  List manifest RPC capability IDs and probes
  build      Build and gzip the router view
  package    Create an installable .ipk
  inspect    Inspect package metadata and file layout

Router:
  target     Manage project-local router targets
  deploy     Upload UI assets for development
  install    Build, package, upload, and opkg install
  uninstall  Remove the project package from a router
  dev        Watch and sync UI-only or full-stack changes
  doctor     Detect firmware and read-only capabilities
  test       Verify router compatibility and deployed plugin
  extract    Inspect firmware UI and RPC contracts

Global options:
  --cwd <dir>    Run against a project in another directory
  --json         Emit one JSON result to stdout
  --quiet, -q    Suppress human progress output
  --verbose, -v  Show additional diagnostics
  --help, -h     Show command help without executing it
  --version      Print CLI version

Run "glplugin <command> --help" for exact command usage.
`;

function usageError(message) {
  return new CliError(message, EXIT_CODES.USAGE);
}

function readOptionValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw usageError(`${option} requires a value.`);
  return value;
}

function parseGlobalArgs(argv, baseCwd) {
  const values = Array.isArray(argv) ? argv : [];
  const parsed = {
    args: [],
    command: '',
    cwd: path.resolve(baseCwd || process.cwd()),
    help: false,
    json: false,
    quiet: false,
    verbose: false,
    version: false,
  };
  let positionalOnly = false;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!positionalOnly && value === '--') {
      positionalOnly = true;
    } else if (!positionalOnly && (value === '--help' || value === '-h')) {
      parsed.help = true;
    } else if (!positionalOnly && value === '--version') {
      parsed.version = true;
    } else if (!positionalOnly && value === '--json') {
      parsed.json = true;
    } else if (!positionalOnly && (value === '--quiet' || value === '-q')) {
      parsed.quiet = true;
    } else if (!positionalOnly && (value === '--verbose' || (value === '-v' && parsed.command))) {
      parsed.verbose = true;
    } else if (!positionalOnly && value === '--cwd') {
      parsed.cwd = path.resolve(parsed.cwd, readOptionValue(values, index, '--cwd'));
      index += 1;
    } else if (!positionalOnly && value.startsWith('--cwd=')) {
      parsed.cwd = path.resolve(parsed.cwd, value.slice('--cwd='.length));
    } else if (!parsed.command && value === '-v') {
      parsed.version = true;
    } else if (!parsed.command) {
      if (value.startsWith('-')) throw usageError(`Unknown global option: ${value}`);
      parsed.command = value;
    } else {
      parsed.args.push(value);
    }
  }

  if (parsed.quiet && parsed.verbose) {
    throw usageError('--quiet and --verbose cannot be used together.');
  }
  if (!fs.existsSync(parsed.cwd) || !fs.statSync(parsed.cwd).isDirectory()) {
    throw usageError(`Working directory does not exist: ${parsed.cwd}`);
  }
  return parsed;
}

function commandHelp(command, args) {
  const usage = COMMAND_HELP[command];
  if (!usage) throw usageError(`Unknown command: ${command}`);
  if (command === 'target' && args && args[0]) {
    if (!TARGET_HELP[args[0]]) throw usageError(`Unknown target action: ${args[0]}`);
    return `\nUsage: ${TARGET_HELP[args[0]]}\n`;
  }
  if (command === 'view' && args && args[0]) {
    if (!VIEW_HELP[args[0]]) throw usageError(`Unknown view action: ${args[0]}`);
    return `\nUsage: ${VIEW_HELP[args[0]]}\n`;
  }
  if (command === 'compatibility' && args && args[0]) {
    if (!COMPATIBILITY_HELP[args[0]]) {
      throw usageError(`Unknown compatibility action: ${args[0]}`);
    }
    return `\nUsage: ${COMPATIBILITY_HELP[args[0]]}\n`;
  }
  return `\nUsage: ${usage}\n`;
}

function createOutput(parsed, io) {
  const streams = io || {};
  const stdout = streams.stdout || process.stdout;
  const stderr = streams.stderr || process.stderr;
  function line(stream, value) {
    stream.write(String(value).replace(/\n?$/, '\n'));
  }
  return {
    always(value) {
      stdout.write(String(value));
    },
    log(value) {
      if (!parsed.quiet && !parsed.json) line(stdout, value);
    },
    verbose(value) {
      if (parsed.verbose && !parsed.json) line(stderr, value);
    },
    warn(value) {
      if (!parsed.quiet && !parsed.json) line(stderr, `Warning: ${value}`);
    },
    write(value) {
      if (!parsed.quiet && !parsed.json) stdout.write(String(value));
    },
    json(value) {
      line(stdout, JSON.stringify(value, null, 2));
    },
    error(value) {
      line(stderr, value);
    },
  };
}

function assertNoArgs(args, command) {
  if (args.length) throw usageError(`Usage: ${COMMAND_HELP[command]}`);
}

function parseTargetAddArgs(args) {
  const parsed = {
    name: '', ssh: '', rpcHost: undefined, username: undefined,
    force: false, https: false, insecure: false, insecureHostKey: false, use: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--rpc-host' || value === '--username') {
      parsed[value === '--rpc-host' ? 'rpcHost' : 'username'] = readOptionValue(args, index, value);
      index += 1;
    } else if (value === '--https') parsed.https = true;
    else if (value === '--insecure') parsed.insecure = true;
    else if (value === '--insecure-host-key') parsed.insecureHostKey = true;
    else if (value === '--use') parsed.use = true;
    else if (value === '--force') parsed.force = true;
    else if (value.startsWith('-')) throw usageError(`Unknown target add option: ${value}`);
    else if (!parsed.name) parsed.name = value;
    else if (!parsed.ssh) parsed.ssh = value;
    else throw usageError('Usage: glplugin target add <name> <[user@]host> [options]');
  }
  if (!parsed.name || !parsed.ssh) {
    throw usageError('Usage: glplugin target add <name> <[user@]host> [options]');
  }
  return parsed;
}

function targetCommand(args, context) {
  const action = args[0];
  const rest = args.slice(1);
  let result;
  if (action === 'add') {
    const parsed = parseTargetAddArgs(rest);
    result = targets.addTarget(context.cwd, parsed.name, parsed.ssh, parsed);
  } else if (action === 'list') {
    assertNoArgs(rest, 'target');
    result = { targets: targets.listTargets(context.cwd) };
  } else if (action === 'show') {
    if (rest.length > 1) throw usageError('Usage: glplugin target show [name]');
    const target = targets.resolveTarget(rest[0], { cwd: context.cwd, env: context.env });
    result = { target };
  } else if (action === 'use') {
    if (rest.length !== 1) throw usageError('Usage: glplugin target use <name>');
    result = { target: targets.useTarget(context.cwd, rest[0]) };
  } else if (action === 'remove') {
    if (rest.length !== 1) throw usageError('Usage: glplugin target remove <name>');
    result = targets.removeTarget(context.cwd, rest[0]);
  } else {
    throw usageError('Usage: glplugin target <add|list|show|use|remove> [arguments]');
  }

  if (!context.json) {
    if (result.targets) {
      if (!result.targets.length) context.output.log('No router targets configured.');
      result.targets.forEach((target) => context.output.log(
        `${target.current ? '*' : ' '} ${target.name}: ${target.ssh} (RPC ${target.rpcHost})`
      ));
    } else if (result.target) {
      context.output.log(`${result.target.name || 'target'}: ${result.target.ssh}`);
    } else if (result.removed) {
      context.output.log(`Removed target "${result.removed}".`);
    } else {
      context.output.log(`Saved target "${result.name}"${result.current ? ' as current' : ''}.`);
    }
  }
  return result;
}

async function dispatch(parsed, output, environment) {
  const context = {
    cwd: parsed.cwd,
    env: environment,
    json: parsed.json,
    quiet: parsed.quiet,
    verbose: parsed.verbose,
    output,
    log: output.log,
    warn: output.warn,
    resolveTarget(value) {
      return targets.resolveTarget(value, { cwd: parsed.cwd, env: environment });
    },
  };
  output.verbose(`cwd=${parsed.cwd}`);

  switch (parsed.command) {
    case 'help': {
      if (parsed.args.length > 1) throw usageError('Usage: glplugin help [command]');
      output.write(parsed.args[0] ? commandHelp(parsed.args[0]) : MAIN_HELP);
      return { help: parsed.args[0] || 'main' };
    }
    case 'target': return targetCommand(parsed.args, context);
    case 'view': return require('./view').cli(parsed.args, context);
    case 'compatibility': return require('./compatibility-candidate').cli(parsed.args, context);
    case 'init': return require('./init').cli(parsed.args, context);
    case 'build':
      assertNoArgs(parsed.args, 'build');
      return require('./build')(context);
    case 'package':
      assertNoArgs(parsed.args, 'package');
      return require('./package')(context);
    case 'check': return require('./check').cli(parsed.args, context);
    case 'capabilities': return require('./capabilities').cli(parsed.args, context);
    case 'inspect': return require('./inspect').cli(parsed.args, context);
    case 'deploy': return require('./deploy')(parsed.args, context);
    case 'install': return require('./workflow').installCli(parsed.args, context);
    case 'uninstall': return require('./workflow').uninstallCli(parsed.args, context);
    case 'dev':
      if (parsed.json) throw usageError('--json is not supported by the long-running dev command.');
      return require('./dev').cli(parsed.args, context);
    case 'doctor': return require('./doctor')(parsed.args, context);
    case 'test': return require('./test')(parsed.args, context);
    case 'extract': return require('./extract')(parsed.args, context);
    default: throw usageError(`Unknown command: ${parsed.command}`);
  }
}

async function run(argv, options) {
  const settings = options || {};
  let parsed;
  let output;
  try {
    parsed = parseGlobalArgs(argv, settings.cwd);
    output = createOutput(parsed, settings);
    if (parsed.version || parsed.command === 'version') {
      if (parsed.command === 'version' && parsed.args.length) {
        throw usageError('Usage: glplugin version');
      }
      output.always(pkg.version + '\n');
      return EXIT_CODES.SUCCESS;
    }
    if (!parsed.command) {
      output.always(MAIN_HELP);
      return EXIT_CODES.SUCCESS;
    }
    if (parsed.help) {
      output.always(commandHelp(parsed.command, parsed.args));
      return EXIT_CODES.SUCCESS;
    }
    const result = await dispatch(parsed, output, settings.env || process.env);
    if (parsed.json) output.json({ ok: true, result: result === undefined ? null : result });
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const exitCode = error && error.exitCode ? error.exitCode : EXIT_CODES.RUNTIME;
    output = output || createOutput({ json: false, quiet: false, verbose: false }, settings);
    if (parsed && parsed.json) {
      output.json({
        ok: false,
        error: {
          message: error.message || String(error),
          exitCode,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    } else {
      output.error(`Error: ${error && error.message ? error.message : error}`);
    }
    return exitCode;
  }
}

module.exports = {
  COMMAND_HELP,
  COMPATIBILITY_HELP,
  MAIN_HELP,
  TARGET_HELP,
  VIEW_HELP,
  commandHelp,
  createOutput,
  dispatch,
  parseGlobalArgs,
  parseTargetAddArgs,
  run,
};
