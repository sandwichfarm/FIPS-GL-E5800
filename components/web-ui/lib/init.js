'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const toolkitPackage = require('../package.json');
const { PROFILES } = require('./manifest');
const { CliError, EXIT_CODES, normalizePluginName } = require('./project');

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');

function replaceTokens(value, tokens) {
  return Object.keys(tokens).reduce(function(result, token) {
    return result.split(token).join(tokens[token]);
  }, value);
}

function copyTemplate(sourceDir, targetDir, tokens, options) {
  const settings = options || {};
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (settings.exclude && settings.exclude.includes(entry.name)) continue;
    const targetName = entry.name === 'gitignore'
      ? '.gitignore'
      : replaceTokens(entry.name, tokens);
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, targetName);

    if (entry.isDirectory()) {
      copyTemplate(source, target, tokens);
    } else if (entry.isFile()) {
      const content = fs.readFileSync(source, 'utf8');
      const mode = fs.statSync(source).mode & 0o777;
      fs.writeFileSync(target, replaceTokens(content, tokens), { mode });
    }
  }
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .map(function(word) { return word[0].toUpperCase() + word.slice(1); })
    .join(' ');
}

function installDependencies(dir, options) {
  const settings = options || {};
  const run = settings.spawnSync || spawnSync;
  const captureOutput = settings.json === true || settings.quiet === true;
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const spawnOptions = {
    cwd: dir,
    shell: false,
    stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  };
  if (captureOutput) spawnOptions.encoding = 'utf8';
  const result = run(command, ['install'], spawnOptions);

  if (result.error) {
    throw new CliError(
      `Unable to run npm install: ${result.error.message}. Project remains at ${dir}.`,
      EXIT_CODES.RUNTIME
    );
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim();
    const reason = detail ? `: ${detail}` : '';
    throw new CliError(
      `npm install failed with status ${result.status}${reason}. ` +
      `Project remains at ${dir}.`,
      EXIT_CODES.RUNTIME
    );
  }
}

module.exports = function init(name, options) {
  if (!name) {
    throw new CliError('Plugin name required. Usage: glplugin init <name>');
  }

  const cwd = options && options.cwd ? path.resolve(options.cwd) : process.cwd();
  const profile = options && options.profile ? options.profile : 'ui-only';
  const log = options && options.log ? options.log : console.log;
  if (!PROFILES.includes(profile)) {
    throw new CliError(`Unsupported plugin profile: ${profile}`);
  }
  const slug = normalizePluginName(name);
  const dir = path.join(cwd, slug);

  if (fs.existsSync(dir)) {
    throw new CliError(`Directory "${slug}" already exists.`);
  }

  const tokens = {
    '__PLUGIN_ID__': slug,
    '__PLUGIN_TITLE__': titleFromSlug(slug),
    '__I18N_KEY__': slug,
    '__KIT_VERSION__': toolkitPackage.version,
  };

  log(`Creating ${profile} plugin "${slug}"...`);
  copyTemplate(TEMPLATE_DIR, dir, tokens, { exclude: ['profiles'] });
  copyTemplate(path.join(TEMPLATE_DIR, 'profiles', profile), dir, tokens);

  const shouldInstall = options && options.install === true;
  if (shouldInstall) {
    log(`Installing dependencies for "${slug}"...`);
    installDependencies(dir, options);
  }

  log(`
  Plugin "${slug}" created!

  Next steps:
    cd ${slug}
    ${shouldInstall ? 'npm run check' : 'npm install'}
    npm run build
    npm run package
  `);

  return { dir, installed: shouldInstall, profile, slug, viewId: slug };
};

function parseInitArgs(args) {
  const values = Array.isArray(args) ? args : [];
  let name;
  let profile = 'ui-only';
  let install = false;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--profile') {
      if (!values[index + 1]) {
        throw new CliError('--profile requires ui-only or full-stack.');
      }
      profile = values[index + 1];
      index += 1;
    } else if (value === '--install') {
      install = true;
    } else if (/^--[a-z]/i.test(value)) {
      throw new CliError(`Unknown init option: ${value}`);
    } else if (name) {
      throw new CliError(
        'Usage: glplugin init <name> [--profile ui-only|full-stack] [--install]'
      );
    } else {
      name = value;
    }
  }

  return { install, name, profile };
}

module.exports.cli = function initCli(args, options) {
  const parsed = parseInitArgs(args);
  return module.exports(parsed.name, {
    cwd: options && options.cwd,
    install: parsed.install,
    json: options && options.json,
    log: options && options.log,
    profile: parsed.profile,
    quiet: options && options.quiet,
  });
};

module.exports.copyTemplate = copyTemplate;
module.exports.installDependencies = installDependencies;
module.exports.normalizePluginName = normalizePluginName;
module.exports.parseInitArgs = parseInitArgs;
