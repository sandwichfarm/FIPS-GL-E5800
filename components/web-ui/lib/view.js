'use strict';

const fs = require('fs');
const path = require('path');
const {
  normalizeManifest,
  readPluginProject,
  resolveProjectPath,
} = require('./manifest');
const { CliError, EXIT_CODES, validatePluginId } = require('./project');

const ADD_USAGE = 'glplugin view add <id> [--title <text>] [--parent <view>|--top-level] ' +
  '[--entry <path>] [--menu <path>] [--icon <name>] [--index <number>]';

function usage(message) {
  return new CliError(message, EXIT_CODES.USAGE);
}

function readOptionValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw usage(`${option} requires a value.`);
  return value;
}

function parseInteger(value, option) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 10000) {
    throw usage(`${option} must be an integer from 0 to 10000.`);
  }
  return number;
}

function parseAddArgs(args) {
  const parsed = {
    id: '', title: '', parent: '', topLevel: false, entry: '', menu: '',
    icon: 'setting', index: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (['--title', '--parent', '--entry', '--menu', '--icon', '--index'].includes(value)) {
      const optionValue = readOptionValue(args, index, value);
      if (value === '--title') parsed.title = optionValue;
      else if (value === '--parent') parsed.parent = optionValue;
      else if (value === '--entry') parsed.entry = optionValue;
      else if (value === '--menu') parsed.menu = optionValue;
      else if (value === '--icon') parsed.icon = optionValue;
      else parsed.index = parseInteger(optionValue, value);
      index += 1;
    } else if (value === '--top-level') parsed.topLevel = true;
    else if (value.startsWith('-')) throw usage(`Unknown view add option: ${value}`);
    else if (!parsed.id) parsed.id = value;
    else throw usage(`Usage: ${ADD_USAGE}`);
  }
  if (!parsed.id) throw usage(`Usage: ${ADD_USAGE}`);
  if (parsed.topLevel && parsed.parent) {
    throw usage('--top-level and --parent cannot be used together.');
  }
  return parsed;
}

function parseRemoveArgs(args) {
  const parsed = { id: '', deleteFiles: false };
  args.forEach((value) => {
    if (value === '--delete-files') parsed.deleteFiles = true;
    else if (value.startsWith('-')) throw usage(`Unknown view remove option: ${value}`);
    else if (!parsed.id) parsed.id = value;
    else throw usage('Usage: glplugin view remove <id> [--delete-files]');
  });
  if (!parsed.id) throw usage('Usage: glplugin view remove <id> [--delete-files]');
  return parsed;
}

function readRawManifest(project) {
  if (project.legacy) {
    throw new CliError(
      'View commands require gl-plugin.json; migrate this legacy project first.',
      EXIT_CODES.VALIDATION
    );
  }
  try {
    return JSON.parse(fs.readFileSync(project.manifestPath, 'utf8'));
  } catch (error) {
    throw new CliError(`Cannot parse gl-plugin.json: ${error.message}`, EXIT_CODES.VALIDATION);
  }
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

function titleFromId(id) {
  return id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function namespacedViewId(project, value) {
  const requested = validatePluginId(value);
  const prefix = `${project.manifest.id}-`;
  return requested === project.manifest.id || requested.startsWith(prefix)
    ? requested
    : `${prefix}${requested}`;
}

function localViewId(project, id) {
  const prefix = `${project.manifest.id}-`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function resolveDeclaredViewId(project, value) {
  const requested = validatePluginId(value);
  if (project.manifest.views.some((view) => view.id === requested)) return requested;
  return namespacedViewId(project, requested);
}

function validateText(value, field) {
  const text = String(value || '').trim();
  if (!text || /[\r\n]/.test(text)) throw usage(`${field} must be non-empty single-line text.`);
  return text;
}

function validateIcon(value, field) {
  const icon = validateText(value, field);
  if (!/^[A-Za-z0-9_-]+$/.test(icon)) {
    throw usage(`${field} must use letters, numbers, underscores, or hyphens.`);
  }
  return icon;
}

function readMenu(project, view) {
  const file = resolveProjectPath(project, view.menu, `views.${view.id}.menu`);
  if (!fs.existsSync(file)) return null;
  try {
    const menu = JSON.parse(fs.readFileSync(file, 'utf8'));
    return menu && typeof menu === 'object' && !Array.isArray(menu) ? menu : null;
  } catch (error) {
    return null;
  }
}

function declaredMenus(project) {
  return project.manifest.views.map((view) => ({ view, menu: readMenu(project, view) }));
}

function nextMenuIndex(items, parent) {
  const matching = items.filter(({ menu }) => menu && (
    parent ? menu.level === 2 && menu.parent === parent : menu.level === 1
  ));
  const indexes = matching.map(({ menu }) => menu.index).filter(Number.isFinite);
  return indexes.length ? Math.max(...indexes) + 10 : (parent ? 10 : 80);
}

function vueSource(id, title) {
  return [
    '<template>',
    '  <div>',
    '    <gl-title :title="title" />',
    '    <gl-card>',
    '      <p>{{ title }}</p>',
    '    </gl-card>',
    '  </div>',
    '</template>',
    '',
    '<script>',
    'export default {',
    `  name: ${JSON.stringify(titleFromId(id).replace(/\s+/g, '') + 'View')},`,
    '  data() {',
    `    return { title: ${JSON.stringify(title)} };`,
    '  },',
    '};',
    '</script>',
    '',
  ].join('\n');
}

function addView(cwd, options) {
  const settings = options || {};
  const project = readPluginProject(cwd);
  const raw = readRawManifest(project);
  const id = namespacedViewId(project, settings.id);
  if (project.manifest.views.some((view) => view.id === id)) {
    throw new CliError(`View "${id}" already exists.`, EXIT_CODES.VALIDATION);
  }

  const localId = localViewId(project, id);
  const title = validateText(settings.title || titleFromId(localId), '--title');
  const icon = validateIcon(settings.icon || 'setting', '--icon');
  const parent = settings.topLevel
    ? null
    : resolveDeclaredViewId(project, settings.parent || project.manifest.id);
  if (parent === id) throw usage('A view cannot be its own parent.');

  const entry = settings.entry || `src/${localId}.vue`;
  const menuPath = settings.menu || `menus/${localId}.json`;
  const view = { id, entry, menu: menuPath };
  const views = [...project.manifest.views, view];
  const candidate = { ...raw, views };
  normalizeManifest(candidate, project.pkg, 'gl-plugin.json');
  if (entry === menuPath) throw usage('--entry and --menu must point to different files.');

  const entryFile = resolveProjectPath(project, entry, `views.${id}.entry`);
  const menuFile = resolveProjectPath(project, menuPath, `views.${id}.menu`);
  [entryFile, menuFile].forEach((file) => {
    if (fs.existsSync(file)) {
      throw new CliError(`Refusing to overwrite existing file: ${file}`, EXIT_CODES.VALIDATION);
    }
  });

  const menuItems = declaredMenus(project);
  const parentItem = menuItems.find((item) => item.view.id === parent);
  const parentMenu = parentItem && parentItem.menu;
  if (parent && !parentItem) {
    throw new CliError(`Parent view "${parent}" is not declared by this plugin.`, EXIT_CODES.VALIDATION);
  }
  if (parent && (!parentMenu || parentMenu.level !== 1)) {
    throw new CliError(
      `Parent view "${parent}" must have a valid level 1 menu.`,
      EXIT_CODES.VALIDATION
    );
  }
  const index = settings.index === null || settings.index === undefined
    ? nextMenuIndex(menuItems, parent)
    : settings.index;
  const menu = {
    index,
    view: id,
    title,
    icon,
    level: parent ? 2 : 1,
    ...(parent ? {
      parent,
      parent_icon: validateIcon(parentMenu.icon, 'parent menu icon'),
      parent_index: Number.isFinite(parentMenu.index) ? parentMenu.index : 80,
    } : {}),
  };

  const created = [];
  try {
    fs.mkdirSync(path.dirname(entryFile), { recursive: true });
    fs.writeFileSync(entryFile, vueSource(localId, title));
    created.push(entryFile);
    fs.mkdirSync(path.dirname(menuFile), { recursive: true });
    writeJsonAtomic(menuFile, menu);
    created.push(menuFile);
    writeJsonAtomic(project.manifestPath, candidate);
  } catch (error) {
    created.forEach((file) => {
      try { fs.rmSync(file); } catch (cleanupError) { /* Preserve the original failure. */ }
    });
    throw error;
  }

  return { view, menu, created: created.map((file) => path.relative(project.cwd, file)) };
}

function listViews(cwd) {
  const project = readPluginProject(cwd);
  return project.manifest.views.map((view) => {
    const menu = readMenu(project, view);
    return {
      ...view,
      primary: view.id === project.manifest.id,
      title: menu ? menu.title : null,
      level: menu ? menu.level : null,
      parent: menu ? menu.parent || null : null,
      index: menu && Number.isFinite(menu.index) ? menu.index : null,
      menu_status: menu ? 'ready' : 'missing',
    };
  });
}

function removeView(cwd, options) {
  const settings = options || {};
  const project = readPluginProject(cwd);
  const raw = readRawManifest(project);
  const id = resolveDeclaredViewId(project, settings.id);
  if (id === project.manifest.id) {
    throw new CliError('The primary view cannot be removed.', EXIT_CODES.VALIDATION);
  }
  const removed = project.manifest.views.find((view) => view.id === id);
  if (!removed) throw new CliError(`Unknown view: ${id}`, EXIT_CODES.VALIDATION);

  const dependent = declaredMenus(project).find(({ view, menu }) => (
    view.id !== id && menu && menu.parent === id
  ));
  if (dependent) {
    throw new CliError(
      `View "${id}" is the parent of "${dependent.view.id}"; remove the child first.`,
      EXIT_CODES.VALIDATION
    );
  }

  const remaining = project.manifest.views.filter((view) => view.id !== id);
  const candidate = { ...raw, views: remaining };
  normalizeManifest(candidate, project.pkg, 'gl-plugin.json');
  writeJsonAtomic(project.manifestPath, candidate);

  const files = [removed.entry, removed.menu];
  const deleted = [];
  const kept = [];
  if (settings.deleteFiles) {
    const referenced = new Set(remaining.flatMap((view) => [view.entry, view.menu]));
    files.forEach((relativeFile) => {
      if (referenced.has(relativeFile)) {
        kept.push(relativeFile);
        return;
      }
      const file = resolveProjectPath(project, relativeFile, `views.${id}`);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        fs.rmSync(file);
        deleted.push(relativeFile);
      }
    });
  } else kept.push(...files);
  return { removed: id, deleted, kept };
}

function viewCli(args, options) {
  const action = args[0];
  const rest = args.slice(1);
  let result;
  if (action === 'add') result = addView(options.cwd, parseAddArgs(rest));
  else if (action === 'list') {
    if (rest.length) throw usage('Usage: glplugin view list');
    result = { views: listViews(options.cwd) };
  } else if (action === 'remove') result = removeView(options.cwd, parseRemoveArgs(rest));
  else throw usage('Usage: glplugin view <add|list|remove> [arguments]');

  if (!options.json) {
    if (result.views) {
      result.views.forEach((view) => options.log(
        `${view.primary ? '*' : ' '} ${view.id}: ${view.entry} (${view.menu_status})`
      ));
    } else if (result.removed) {
      options.log(`Removed view "${result.removed}".`);
      if (result.kept.length) options.log(`Kept files: ${result.kept.join(', ')}`);
    } else {
      options.log(`Added view "${result.view.id}".`);
      options.log(`Created: ${result.created.join(', ')}`);
    }
  }
  return result;
}

module.exports = {
  ADD_USAGE,
  addView,
  cli: viewCli,
  listViews,
  parseAddArgs,
  parseRemoveArgs,
  removeView,
  resolveDeclaredViewId,
};
