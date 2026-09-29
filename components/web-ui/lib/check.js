'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  readPluginProject,
  resolveProjectPath,
  validateI18nFilename,
} = require('./manifest');
const { CliError, EXIT_CODES } = require('./project');

function result(id, status, message) {
  return { id, status, message };
}

function parseJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function validateMenu(menu, pluginId, label) {
  const menuLabel = label || 'menu.json';
  if (!menu || typeof menu !== 'object' || Array.isArray(menu)) {
    throw new Error(`${menuLabel} must contain one object.`);
  }
  if (menu.view !== pluginId) throw new Error(`${menuLabel} view must be "${pluginId}".`);
  if (!Number.isFinite(menu.index)) throw new Error(`${menuLabel} index must be a number.`);
  if (![1, 2].includes(menu.level)) throw new Error(`${menuLabel} level must be 1 or 2.`);
  if (typeof menu.icon !== 'string' || !menu.icon) throw new Error(`${menuLabel} icon is required.`);
  if (typeof menu.title !== 'string' &&
      (!menu.title || typeof menu.title.translate !== 'string')) {
    throw new Error(`${menuLabel} title must be a string or { "translate": "..." }.`);
  }
  if (menu.level === 2 && (typeof menu.parent !== 'string' || !menu.parent)) {
    throw new Error(`A level 2 ${menuLabel} entry requires parent.`);
  }
}

function newestMtime(root) {
  if (!fs.existsSync(root)) return 0;
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs.readdirSync(root).reduce(
    (newest, entry) => Math.max(newest, newestMtime(path.join(root, entry))),
    stat.mtimeMs
  );
}

function checkProject(cwd, options) {
  const settings = options || {};
  const root = path.resolve(cwd || process.cwd());
  const checks = [];
  let project;
  const menus = [];

  try {
    project = readPluginProject(root);
    checks.push(result('manifest', 'pass', `${project.manifest.profile} manifest is valid`));
  } catch (error) {
    checks.push(result('manifest', 'fail', error.message));
    return { ok: false, strict: settings.strict === true, cwd: root, project: null, checks };
  }

  project.manifest.views.forEach((view) => {
    const primary = view.id === project.manifest.id;
    const menuCheckId = primary ? 'menu' : `menu.${view.id}`;
    const sourceCheckId = primary ? 'source' : `source.${view.id}`;
    const menuFile = resolveProjectPath(project, view.menu, `views.${view.id}.menu`);
    const sourceFile = resolveProjectPath(project, view.entry, `views.${view.id}.entry`);
    try {
      const menu = parseJson(menuFile, view.menu);
      validateMenu(menu, view.id, view.menu);
      menus.push({ file: menuFile, menu, view });
      checks.push(result(menuCheckId, 'pass', `${view.menu} matches view "${view.id}"`));
    } catch (error) {
      checks.push(result(menuCheckId, 'fail', error.message));
    }
    checks.push(fs.existsSync(sourceFile) && fs.statSync(sourceFile).isFile()
      ? result(sourceCheckId, 'pass', `${view.entry} exists`)
      : result(sourceCheckId, 'fail', `${view.entry} is missing`));
  });

  const webpackFile = path.join(root, 'webpack.config.js');
  checks.push(fs.existsSync(webpackFile) && fs.statSync(webpackFile).isFile()
    ? result('webpack-config', 'pass', 'webpack.config.js exists')
    : result('webpack-config', 'fail', 'webpack.config.js is missing'));

  const i18nDir = path.join(root, 'i18n');
  if (!fs.existsSync(i18nDir) || !fs.statSync(i18nDir).isDirectory()) {
    checks.push(result('i18n', 'warn', 'i18n directory is missing'));
  } else {
    const localeFiles = fs.readdirSync(i18nDir).filter((name) => name.endsWith('.json'));
    const invalid = [];
    const locales = [];
    localeFiles.forEach((name) => {
      try {
        validateI18nFilename(name, project.manifest.id);
        const value = parseJson(path.join(i18nDir, name), name);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`${name}: root must be an object`);
        }
        locales.push(value);
      } catch (error) {
        invalid.push(error.message);
      }
    });
    if (invalid.length) checks.push(result('i18n', 'fail', invalid.join('; ')));
    else if (!localeFiles.length) checks.push(result('i18n', 'warn', 'no locale JSON files found'));
    else {
      const missingTranslation = menus.find(({ menu }) => (
        menu.title && menu.title.translate && !locales.some((locale) =>
          menu.title.translate.split('.').reduce(
            (value, key) => value && typeof value === 'object' ? value[key] : undefined,
            locale
          ) !== undefined
        )
      ));
      if (missingTranslation) {
        checks.push(result(
          'i18n', 'fail', `translation key is missing: ${missingTranslation.menu.title.translate}`
        ));
      } else checks.push(result('i18n', 'pass', `${localeFiles.length} locale file(s) are valid`));
    }
  }

  try {
    require.resolve('webpack/package.json', { paths: [root] });
    require.resolve('vue-template-compiler/package.json', { paths: [root] });
    checks.push(result('toolchain', 'pass', 'webpack and Vue template compiler are installed'));
  } catch (error) {
    checks.push(result('toolchain', 'fail', 'dependencies are missing; run npm install'));
  }

  if (project.manifest.profile === 'full-stack') {
    const overlay = resolveProjectPath(project, project.manifest.overlay, 'overlay');
    checks.push(fs.existsSync(overlay) && fs.statSync(overlay).isDirectory()
      ? result('overlay', 'pass', 'full-stack overlay exists')
      : result('overlay', 'fail', `overlay directory is missing: ${project.manifest.overlay}`));

    Object.entries(project.manifest.lifecycle).forEach(([name, relativeFile]) => {
      const file = resolveProjectPath(project, relativeFile, `lifecycle.${name}`);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        checks.push(result(`lifecycle.${name}`, 'fail', `script is missing: ${relativeFile}`));
        return;
      }
      const syntax = (settings.spawnSync || spawnSync)('sh', ['-n', file], {
        encoding: 'utf8', shell: false,
      });
      if (syntax.error || syntax.status !== 0) {
        checks.push(result(
          `lifecycle.${name}`,
          'fail',
          String(syntax.stderr || (syntax.error && syntax.error.message) || 'shell syntax error').trim()
        ));
      } else if (!(fs.statSync(file).mode & 0o100)) {
        checks.push(result(`lifecycle.${name}`, 'warn', `${relativeFile} is not executable`));
      } else {
        checks.push(result(`lifecycle.${name}`, 'pass', `${relativeFile} is executable and valid`));
      }
    });
  }

  project.manifest.views.forEach((view) => {
    const primary = view.id === project.manifest.id;
    const checkId = primary ? 'artifact' : `artifact.${view.id}`;
    const artifact = path.join(root, 'dist', `gl-sdk4-ui-${view.id}.common.js.gz`);
    if (!fs.existsSync(artifact)) {
      checks.push(result(checkId, 'warn', `no build artifact for "${view.id}"; run glplugin build`));
      return;
    }
    const inputs = Math.max(
      newestMtime(resolveProjectPath(project, view.entry, `views.${view.id}.entry`)),
      newestMtime(resolveProjectPath(project, view.menu, `views.${view.id}.menu`)),
      newestMtime(webpackFile)
    );
    checks.push(fs.statSync(artifact).mtimeMs < inputs
      ? result(checkId, 'warn', `build artifact for "${view.id}" is older than project sources`)
      : result(checkId, 'pass', `build artifact for "${view.id}" is current`));
  });

  const strict = settings.strict === true;
  const ok = !checks.some((check) => check.status === 'fail' || (strict && check.status === 'warn'));
  return {
    ok,
    strict,
    cwd: root,
    project: { id: project.manifest.id, profile: project.manifest.profile },
    summary: checks.reduce((summary, check) => {
      summary[check.status] = (summary[check.status] || 0) + 1;
      return summary;
    }, {}),
    checks,
  };
}

function parseCheckArgs(args) {
  const parsed = { strict: false };
  args.forEach((value) => {
    if (value === '--strict') parsed.strict = true;
    else throw new CliError('Usage: glplugin check [--strict]', EXIT_CODES.USAGE);
  });
  return parsed;
}

function checkCli(args, options) {
  const parsed = parseCheckArgs(args);
  const report = checkProject(options && options.cwd, {
    strict: parsed.strict,
    spawnSync: options && options.spawnSync,
  });
  const log = options && options.log ? options.log : console.log;
  if (!(options && options.json)) {
    report.checks.forEach((check) => log(`  [${check.status.toUpperCase()}] ${check.id}: ${check.message}`));
    log(`\nProject check: ${report.ok ? 'passed' : 'failed'}`);
  }
  if (!report.ok) {
    const error = new CliError('Project check failed.', EXIT_CODES.VALIDATION);
    error.details = report;
    throw error;
  }
  return report;
}

module.exports = { checkProject, cli: checkCli, parseCheckArgs, validateMenu };
