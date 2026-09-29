'use strict';

const fs = require('fs');
const path = require('path');
const deploy = require('./deploy');
const { readPluginProject } = require('./manifest');
const { CliError, EXIT_CODES } = require('./project');
const { openSshSession } = require('./ssh-transport');
const { installPlugin } = require('./workflow');

const UI_ACTION = 'ui';
const PACKAGE_ACTION = 'package';

function parseDevArgs(args) {
  const parsed = {
    target: '', debounce: 300, hostKeyPolicy: null, allowUnverified: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--debounce') {
      const delay = Number(args[index + 1]);
      if (!Number.isInteger(delay) || delay < 50 || delay > 10000) {
        throw new CliError('--debounce must be an integer from 50 to 10000.', EXIT_CODES.USAGE);
      }
      parsed.debounce = delay;
      index += 1;
    } else if (value === '--allow-unverified') parsed.allowUnverified = true;
    else if (value === '--insecure-host-key') parsed.hostKeyPolicy = 'insecure';
    else if (value === '--strict-host-key') parsed.hostKeyPolicy = 'strict';
    else if (value.startsWith('-')) throw new CliError(`Unknown dev option: ${value}`, EXIT_CODES.USAGE);
    else if (!parsed.target) parsed.target = value;
    else throw new CliError(
      'Usage: glplugin dev [target|host] [--debounce <ms>] [--allow-unverified]',
      EXIT_CODES.USAGE
    );
  }
  return parsed;
}

function watchDirectories(root, project) {
  const result = [];
  const pluginProject = project || readPluginProject(root);
  const topLevelDirectories = new Set(['i18n']);
  function addTopLevel(relativePath) {
    if (relativePath.includes('/')) topLevelDirectories.add(relativePath.split('/')[0]);
  }
  function addTopLevelDirectory(relativePath) {
    topLevelDirectories.add(relativePath.split('/')[0]);
  }
  pluginProject.manifest.views.forEach((view) => {
    [view.entry, view.menu].forEach(addTopLevel);
  });
  if (pluginProject.manifest.profile === 'full-stack') {
    if (pluginProject.manifest.overlay) addTopLevelDirectory(pluginProject.manifest.overlay);
    Object.values(pluginProject.manifest.lifecycle || {}).forEach(addTopLevel);
  }
  function visit(dir) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
    result.push(dir);
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) {
        visit(path.join(dir, entry.name));
      }
    });
  }
  topLevelDirectories.forEach((name) => visit(path.join(root, name)));
  return result;
}

function platformSignature(project) {
  return JSON.stringify({
    compatibility: project.manifest.compatibility,
    id: project.manifest.id,
    package: project.manifest.package,
    profile: project.manifest.profile,
    views: project.manifest.views,
  });
}

function relatedProjectPath(first, second) {
  return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`);
}

function changeAction(project, relativePath) {
  if (!project || project.manifest.profile !== 'full-stack') return UI_ACTION;
  if (relativePath === 'gl-plugin.json' || relativePath === 'package.json') {
    return PACKAGE_ACTION;
  }
  const packagePaths = [
    project.manifest.overlay,
    ...Object.values(project.manifest.lifecycle || {}),
  ].filter(Boolean);
  return packagePaths.some((candidate) => relatedProjectPath(relativePath, candidate))
    ? PACKAGE_ACTION
    : UI_ACTION;
}

function rootWatchNames(project) {
  const names = new Set(['.babelrc', 'gl-plugin.json', 'package.json', 'webpack.config.js', 'i18n']);
  const paths = project.manifest.views.flatMap((view) => [view.entry, view.menu]);
  if (project.manifest.profile === 'full-stack') {
    paths.push(project.manifest.overlay, ...Object.values(project.manifest.lifecycle || {}));
  }
  paths.filter(Boolean).forEach((relativePath) => names.add(relativePath.split('/')[0]));
  return names;
}

function mergeAction(current, next) {
  if (current === PACKAGE_ACTION || next === PACKAGE_ACTION) return PACKAGE_ACTION;
  return current || next || UI_ACTION;
}

function startDev(options) {
  const settings = options || {};
  const root = path.resolve(settings.cwd || process.cwd());
  const log = settings.log || console.log;
  const watch = settings.watch || fs.watch;
  const deployPlugin = settings.deployPlugin || deploy;
  const installPackage = settings.installPlugin || installPlugin;
  const createSession = settings.openSshSession || openSshSession;
  const deployArgs = [settings.target.ssh, '--build'];
  if (settings.insecureHostKey) deployArgs.push('--insecure-host-key');
  else deployArgs.push('--strict-host-key');
  if (settings.allowUnverified) deployArgs.push('--allow-unverified');

  let running = false;
  let pendingAction = null;
  let scheduledAction = null;
  let timer = null;
  let closed = false;
  let verifiedSignature = null;
  let currentProject = null;
  let packageSyncRequired = false;
  const watchers = new Map();
  const session = createSession(settings.target.ssh, {
    insecureHostKey: settings.insecureHostKey,
    spawnSync: settings.spawnSync,
  });

  function syncWatchers(project) {
    const desired = new Set(watchDirectories(root, project));
    for (const [dir, watcher] of watchers) {
      if (dir !== root && !desired.has(dir)) {
        watcher.close();
        watchers.delete(dir);
      }
    }
    desired.forEach((dir) => {
      if (!watchers.has(dir)) {
        watchers.set(dir, watch(dir, { persistent: true }, (event, filename) => {
          const relativeDir = path.relative(root, dir).split(path.sep).join('/');
          const relativePath = filename
            ? path.posix.join(relativeDir, String(filename))
            : relativeDir;
          schedule(changeAction(currentProject, relativePath));
        }));
      }
    });
  }

  function cycle(requestedAction) {
    if (closed) return;
    if (requestedAction === PACKAGE_ACTION) packageSyncRequired = true;
    if (running) {
      pendingAction = mergeAction(pendingAction, requestedAction);
      return;
    }
    running = true;
    try {
      const project = readPluginProject(root);
      currentProject = project;
      syncWatchers(project);
      const signature = platformSignature(project);
      const skipPlatformCheck = verifiedSignature === signature;
      const action = project.manifest.profile === 'full-stack' && packageSyncRequired
        ? PACKAGE_ACTION
        : UI_ACTION;
      if (action === PACKAGE_ACTION) {
        installPackage({
          allowUnverified: settings.allowUnverified,
          build: true,
          controlPath: session.options.controlPath,
          cwd: root,
          forceReinstall: true,
          insecureHostKey: settings.insecureHostKey,
          log,
          skipPlatformCheck,
          spawnSync: settings.spawnSync,
          target: settings.target,
        });
        packageSyncRequired = false;
      } else {
        deployPlugin(deployArgs, {
          controlPath: session.options.controlPath,
          cwd: root,
          log,
          skipPlatformCheck,
          spawnSync: settings.spawnSync,
          suppressFullStackWarning: project.manifest.profile === 'full-stack',
        });
      }
      verifiedSignature = signature;
      currentProject = readPluginProject(root);
      syncWatchers(currentProject);
    } catch (error) {
      (settings.warn || console.error)(`Development sync failed: ${error.message}`);
    } finally {
      running = false;
      if (pendingAction) {
        const nextAction = pendingAction;
        pendingAction = null;
        cycle(nextAction);
      }
    }
  }

  function schedule(action) {
    scheduledAction = mergeAction(scheduledAction, action);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const nextAction = scheduledAction;
      scheduledAction = null;
      cycle(nextAction);
    }, settings.debounce || 300);
  }

  try {
    currentProject = readPluginProject(root);
    cycle(currentProject.manifest.profile === 'full-stack' ? PACKAGE_ACTION : UI_ACTION);
    watchers.set(root, watch(root, { persistent: true }, (event, filename) => {
      const name = filename ? String(filename) : '';
      let project = currentProject;
      try {
        project = readPluginProject(root);
      } catch (error) {
        // Keep watching the last valid manifest while the edited file is incomplete.
      }
      if (!project || (name && !rootWatchNames(project).has(name))) return;
      schedule(changeAction(project, name));
    }));
  } catch (error) {
    watchers.forEach((watcher) => watcher.close());
    session.close();
    throw error;
  }
  log(`Watching ${watchers.size} project path(s). Press Ctrl+C to stop.`);

  let signalHandler = null;
  const controller = {
    target: settings.target.ssh,
    get watched() { return watchers.size; },
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      scheduledAction = null;
      pendingAction = null;
      packageSyncRequired = false;
      watchers.forEach((watcher) => watcher.close());
      session.close();
      if (signalHandler) process.off('SIGINT', signalHandler);
    },
  };
  if (settings.signals !== false) {
    signalHandler = () => {
      controller.close();
      log('Development watcher stopped.');
    };
    process.once('SIGINT', signalHandler);
  }
  return controller;
}

function devCli(args, options) {
  const parsed = parseDevArgs(args);
  const target = options.resolveTarget(parsed.target);
  const insecureHostKey = parsed.hostKeyPolicy === 'insecure' ||
    (parsed.hostKeyPolicy === null && target.insecureHostKey);
  return startDev({
    cwd: options.cwd,
    debounce: parsed.debounce,
    insecureHostKey,
    allowUnverified: parsed.allowUnverified,
    log: options.log,
    warn: options.warn,
    target,
  });
}

module.exports = {
  cli: devCli,
  parseDevArgs,
  startDev,
  watchDirectories,
};
