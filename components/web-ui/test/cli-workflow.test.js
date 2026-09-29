'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const zlib = require('zlib');
const cli = require('../lib/cli');
const { checkProject } = require('../lib/check');
const dev = require('../lib/dev');
const init = require('../lib/init');
const { normalizeArchiveEntry } = require('../lib/inspect');
const targetConfig = require('../lib/target-config');
const { verifyRouter } = require('../lib/test');
const view = require('../lib/view');
const { installPlugin, uninstallPlugin } = require('../lib/workflow');
const { compatiblePlatform, makeTempDir, removeTempDir } = require('./helpers');

const repositoryRoot = path.resolve(__dirname, '..');

function memoryStream() {
  return {
    value: '',
    write(chunk) { this.value += String(chunk); },
  };
}

function successful(stdout) {
  return { status: 0, stdout: stdout || Buffer.alloc(0), stderr: Buffer.alloc(0) };
}

test('command help is side-effect free and global options parse consistently', async function() {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await cli.run(['build', '--help'], { cwd: repositoryRoot, stdout, stderr });
  assert.equal(code, 0);
  assert.match(stdout.value, /Usage: glplugin build/);
  assert.doesNotMatch(stdout.value + stderr.value, /Building plugin|No gl-plugin/);

  const initHelp = memoryStream();
  assert.equal(await cli.run(
    ['init', '--help'],
    { cwd: repositoryRoot, stdout: initHelp, stderr: memoryStream() }
  ), 0);
  assert.match(initHelp.value, /init <name>.*--install/);

  const parsed = cli.parseGlobalArgs([
    '--cwd', 'test', 'doctor', '--json', '--quiet', 'router.local', '--https',
  ], repositoryRoot);
  assert.equal(parsed.command, 'doctor');
  assert.equal(parsed.cwd, path.join(repositoryRoot, 'test'));
  assert.equal(parsed.json, true);
  assert.equal(parsed.quiet, true);
  assert.deepEqual(parsed.args, ['router.local', '--https']);

  const targetHelp = memoryStream();
  assert.equal(await cli.run(
    ['target', 'add', '--help'],
    { cwd: repositoryRoot, stdout: targetHelp, stderr: memoryStream() }
  ), 0);
  assert.match(targetHelp.value, /target add <name> <\[user@\]host>/);

  const capabilityOut = memoryStream();
  assert.equal(await cli.run(
    ['capabilities', '--json'],
    { cwd: repositoryRoot, stdout: capabilityOut, stderr: memoryStream() }
  ), 0);
  const capabilityResult = JSON.parse(capabilityOut.value);
  assert.equal(capabilityResult.result.capabilities[0].id, 'clients');
  assert.equal(
    capabilityResult.result.capabilities.find((item) => item.id === 'repeater').rpc,
    'repeater.get_status'
  );
});

test('target commands persist validated connection settings without credentials', async function(t) {
  const cwd = makeTempDir('glplugin-target-');
  t.after(() => removeTempDir(cwd));
  const stdout = memoryStream();
  const stderr = memoryStream();

  assert.equal(await cli.run([
    '--cwd', cwd, 'target', 'add', 'beryl', 'admin@router.local',
    '--rpc-host', 'rpc.router.local', '--https', '--use',
  ], { stdout, stderr }), 0);

  const file = targetConfig.configPath(cwd);
  const persisted = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(persisted, /password|secret|token/i);
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  assert.deepEqual(targetConfig.resolveTarget('beryl', { cwd }), {
    name: 'beryl',
    source: 'config',
    ssh: 'admin@router.local',
    rpcHost: 'rpc.router.local',
    username: 'admin',
    https: true,
    insecure: false,
    insecureHostKey: false,
  });
  assert.equal(targetConfig.resolveTarget(null, { cwd }).name, 'beryl');
  assert.equal(
    targetConfig.resolveTarget(null, { cwd, env: { GLPLUGIN_HOST: 'env.router' } }).source,
    'environment'
  );

  const jsonOut = memoryStream();
  assert.equal(await cli.run(
    ['--cwd', cwd, 'target', 'list', '--json'],
    { stdout: jsonOut, stderr: memoryStream() }
  ), 0);
  const listed = JSON.parse(jsonOut.value);
  assert.equal(listed.ok, true);
  assert.equal(listed.result.targets[0].name, 'beryl');
});

test('project check validates menu, locales, toolchain, and strict warnings', async function(t) {
  const cwd = makeTempDir('glplugin-check-');
  t.after(() => removeTempDir(cwd));
  const project = init('check-fixture', { cwd, log() {} });
  fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(project.dir, 'node_modules'));

  const report = checkProject(project.dir);
  assert.equal(report.ok, true);
  assert.equal(report.checks.find((item) => item.id === 'artifact').status, 'warn');
  assert.equal(checkProject(project.dir, { strict: true }).ok, false);

  const jsonOut = memoryStream();
  const successCode = await cli.run(
    ['--cwd', project.dir, 'check', '--json'],
    { stdout: jsonOut, stderr: memoryStream() }
  );
  assert.equal(successCode, 0);
  const output = JSON.parse(jsonOut.value);
  assert.equal(output.ok, true);
  assert.equal(output.result.project.id, 'check-fixture');

  const menuFile = path.join(project.dir, 'menu.json');
  const menu = JSON.parse(fs.readFileSync(menuFile, 'utf8'));
  menu.view = 'wrong-view';
  fs.writeFileSync(menuFile, JSON.stringify(menu));
  const invalid = checkProject(project.dir);
  assert.equal(invalid.ok, false);
  assert.match(invalid.checks.find((item) => item.id === 'menu').message, /must be "check-fixture"/);

  const errorOut = memoryStream();
  const failureCode = await cli.run(
    ['--cwd', project.dir, 'check', '--json'],
    { stdout: errorOut, stderr: memoryStream() }
  );
  assert.equal(failureCode, 3);
  const failure = JSON.parse(errorOut.value);
  assert.equal(failure.ok, false);
  assert.equal(failure.error.exitCode, 3);
  assert.equal(failure.error.details.ok, false);
});

test('archive path validation rejects traversal before package inspection', function() {
  assert.equal(normalizeArchiveEntry('./www/views/plugin.js.gz'), 'www/views/plugin.js.gz');
  assert.throws(() => normalizeArchiveEntry('../etc/passwd'), /Unsafe archive path/);
  assert.throws(() => normalizeArchiveEntry('/etc/passwd'), /Unsafe archive path/);
});

test('install and uninstall workflows use exact SCP and SSH argument arrays', function(t) {
  const cwd = makeTempDir('glplugin-workflow-');
  t.after(() => removeTempDir(cwd));
  const project = init('workflow-fixture', { cwd, log() {} });
  const ipkFile = path.join(project.dir, 'workflow-fixture_1.0.0_all.ipk');
  fs.writeFileSync(ipkFile, 'fixture');
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return successful();
  };
  const target = { ssh: 'root@router.local' };

  const installed = installPlugin({
    cwd: project.dir,
    target,
    checkProject() { return { ok: true }; },
    buildPlugin() {},
    packagePlugin() {
      return { ipkFile, packageName: 'gl-sdk4-ui-workflow-fixture' };
    },
    inspectPlatform() { return compatiblePlatform(); },
    log() {},
    spawnSync,
  });
  assert.equal(installed.remotePath, '/tmp/workflow-fixture_1.0.0_all.ipk');
  assert.deepEqual(calls.map((call) => call.command), ['ssh', 'scp', 'ssh', 'ssh']);
  assert.equal(calls[0].args.includes('ControlMaster=yes'), true);
  assert.match(
    calls[2].args.at(-1),
    /^opkg install \/tmp\/workflow-fixture.*; status=\$\?; rm -f \/tmp\/workflow-fixture.*; exit "\$status"$/
  );
  assert.equal(calls[3].args.includes('exit'), true);

  uninstallPlugin({ cwd: project.dir, target, log() {}, spawnSync });
  assert.equal(calls[4].command, 'ssh');
  assert.equal(calls[4].args.at(-1), 'opkg remove gl-sdk4-ui-workflow-fixture');
  calls.forEach((call) => assert.equal(call.options.shell, false));
});

test('install workflow can reuse a verified development session', function(t) {
  const cwd = makeTempDir('glplugin-workflow-reuse-');
  t.after(() => removeTempDir(cwd));
  const project = init('workflow-reuse', { cwd, log() {} });
  const ipkFile = path.join(project.dir, 'workflow-reuse_1.0.0_all.ipk');
  fs.writeFileSync(ipkFile, 'fixture');
  let platformInspections = 0;
  const calls = [];

  const result = installPlugin({
    cwd: project.dir,
    target: { ssh: 'root@router.local' },
    controlPath: '/tmp/test-control-socket',
    forceReinstall: true,
    skipPlatformCheck: true,
    checkProject() { return { ok: true }; },
    buildPlugin() {},
    packagePlugin() {
      return { ipkFile, packageName: 'gl-sdk4-ui-workflow-reuse' };
    },
    inspectPlatform() {
      platformInspections += 1;
      return compatiblePlatform();
    },
    log() {},
    spawnSync(command, args) {
      calls.push({ command, args });
      return successful();
    },
  });

  assert.equal(platformInspections, 0);
  assert.equal(result.compatibility, null);
  const installCall = calls.find((call) => (
    call.command === 'ssh' && String(call.args.at(-1)).startsWith('opkg install')
  ));
  assert.match(
    installCall.args.at(-1),
    /^opkg install --force-reinstall \/tmp\/workflow-reuse_1\.0\.0_all\.ipk;/
  );
});

test('dev performs an initial build/deploy and closes all watchers', function(t) {
  const cwd = makeTempDir('glplugin-dev-');
  t.after(() => removeTempDir(cwd));
  const project = init('dev-fixture', { cwd, log() {} });
  fs.mkdirSync(path.join(project.dir, 'pages'));
  fs.mkdirSync(path.join(project.dir, 'navigation'));
  fs.copyFileSync(
    path.join(project.dir, 'src', 'index.vue'),
    path.join(project.dir, 'pages', 'details.vue')
  );
  fs.writeFileSync(path.join(project.dir, 'navigation', 'details.json'), '{}\n');
  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.views = [
    { id: 'dev-fixture', entry: 'src/index.vue', menu: 'menu.json' },
    { id: 'dev-fixture-details', entry: 'pages/details.vue', menu: 'navigation/details.json' },
  ];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const watchers = [];
  const watchedPaths = [];
  let deploys = 0;
  let sessionCloses = 0;
  const controller = dev.startDev({
    cwd: project.dir,
    target: { ssh: 'root@router.local' },
    signals: false,
    log() {},
    warn() {},
    deployPlugin(args, options) {
      deploys += 1;
      assert.equal(args.includes('--build'), true);
      assert.equal(options.controlPath, '/tmp/test-control-socket');
    },
    openSshSession() {
      return {
        options: { controlPath: '/tmp/test-control-socket' },
        close() { sessionCloses += 1; },
      };
    },
    watch(watchedPath) {
      watchedPaths.push(watchedPath);
      const watcher = { closed: false, close() { this.closed = true; } };
      watchers.push(watcher);
      return watcher;
    },
  });
  assert.equal(deploys, 1);
  assert.equal(controller.watched, watchers.length);
  assert.equal(watchedPaths.includes(path.join(project.dir, 'src')), true);
  assert.equal(watchedPaths.includes(path.join(project.dir, 'pages')), true);
  assert.equal(watchedPaths.includes(path.join(project.dir, 'navigation')), true);
  controller.close();
  assert.equal(watchers.every((watcher) => watcher.closed), true);
  assert.equal(sessionCloses, 1);
  controller.close();
  assert.equal(sessionCloses, 1);
});

test('dev refreshes watchers and repeats platform preflight after manifest changes', async function(t) {
  const cwd = makeTempDir('glplugin-dev-refresh-');
  t.after(() => removeTempDir(cwd));
  const project = init('dev-refresh', { cwd, log() {} });
  const watchers = new Map();
  const deployOptions = [];
  const controller = dev.startDev({
    cwd: project.dir,
    debounce: 5,
    target: { ssh: 'root@router.local' },
    signals: false,
    log() {},
    warn() {},
    deployPlugin(args, options) { deployOptions.push(options); },
    openSshSession() {
      return { options: { controlPath: '/tmp/test-control-socket' }, close() {} };
    },
    watch(watchedPath, options, callback) {
      const watcher = { callback, close() { watchers.delete(watchedPath); } };
      watchers.set(watchedPath, watcher);
      return watcher;
    },
  });

  assert.equal(deployOptions[0].skipPlatformCheck, false);
  view.addView(project.dir, { id: 'details', title: 'Details' });
  watchers.get(project.dir).callback('change', 'gl-plugin.json');
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(deployOptions[1].skipPlatformCheck, false);
  assert.equal(watchers.has(path.join(project.dir, 'menus')), true);

  watchers.get(path.join(project.dir, 'src')).callback('change', 'index.vue');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(deployOptions[2].skipPlatformCheck, true);
  controller.close();
});

test('full-stack dev installs packages only for backend and package changes', async function(t) {
  const cwd = makeTempDir('glplugin-dev-full-stack-');
  t.after(() => removeTempDir(cwd));
  const project = init('dev-full-stack', { cwd, profile: 'full-stack', log() {} });
  const defaultWatchPaths = dev.watchDirectories(project.dir);
  assert.equal(defaultWatchPaths.includes(path.join(project.dir, 'overlay')), true);
  assert.equal(defaultWatchPaths.includes(path.join(project.dir, 'hooks')), true);
  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.mkdirSync(path.join(project.dir, 'router-files'), { recursive: true });
  fs.renameSync(
    path.join(project.dir, 'overlay'),
    path.join(project.dir, 'router-files', 'root')
  );
  fs.mkdirSync(path.join(project.dir, 'scripts'), { recursive: true });
  fs.renameSync(
    path.join(project.dir, 'hooks'),
    path.join(project.dir, 'scripts', 'package')
  );
  manifest.overlay = 'router-files/root';
  manifest.lifecycle = {
    postinst: 'scripts/package/postinst',
    prerm: 'scripts/package/prerm',
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const watchers = new Map();
  const deployOptions = [];
  const installOptions = [];
  const controller = dev.startDev({
    cwd: project.dir,
    debounce: 5,
    target: { ssh: 'root@router.local' },
    signals: false,
    log() {},
    warn() {},
    deployPlugin(args, options) { deployOptions.push(options); },
    installPlugin(options) { installOptions.push(options); },
    openSshSession() {
      return { options: { controlPath: '/tmp/test-control-socket' }, close() {} };
    },
    watch(watchedPath, options, callback) {
      const watcher = { callback, close() { watchers.delete(watchedPath); } };
      watchers.set(watchedPath, watcher);
      return watcher;
    },
  });

  assert.equal(installOptions.length, 1);
  assert.equal(deployOptions.length, 0);
  assert.equal(installOptions[0].forceReinstall, true);
  assert.equal(installOptions[0].skipPlatformCheck, false);
  assert.equal(watchers.has(path.join(project.dir, 'router-files')), true);
  assert.equal(watchers.has(path.join(project.dir, 'scripts')), true);

  watchers.get(path.join(project.dir, 'src')).callback('change', 'index.vue');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(deployOptions.length, 1);
  assert.equal(deployOptions[0].skipPlatformCheck, true);
  assert.equal(installOptions.length, 1);

  watchers.get(path.join(project.dir, 'router-files')).callback('change', 'root');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(installOptions.length, 2);
  assert.equal(installOptions[1].skipPlatformCheck, true);

  watchers.get(path.join(project.dir, 'scripts')).callback('change', 'package');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(installOptions.length, 3);
  assert.equal(installOptions[2].skipPlatformCheck, true);

  watchers.get(path.join(project.dir, 'src')).callback('change', 'index.vue');
  watchers.get(path.join(project.dir, 'router-files')).callback('change', 'root');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(installOptions.length, 4);
  assert.equal(deployOptions.length, 1);

  manifest.package.depends.push('tcpdump-mini');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  watchers.get(project.dir).callback('change', 'gl-plugin.json');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(installOptions.length, 5);
  assert.equal(installOptions[4].skipPlatformCheck, false);

  controller.close();
});

test('full-stack dev keeps watching and retries a failed package sync', async function(t) {
  const cwd = makeTempDir('glplugin-dev-full-stack-retry-');
  t.after(() => removeTempDir(cwd));
  const project = init('dev-full-stack-retry', { cwd, profile: 'full-stack', log() {} });
  const watchers = new Map();
  const warnings = [];
  let installs = 0;
  let deploys = 0;
  const controller = dev.startDev({
    cwd: project.dir,
    debounce: 5,
    target: { ssh: 'root@router.local' },
    signals: false,
    log() {},
    warn(message) { warnings.push(message); },
    deployPlugin() { deploys += 1; },
    installPlugin() {
      installs += 1;
      if (installs === 1) throw new Error('fixture install failure');
    },
    openSshSession() {
      return { options: { controlPath: '/tmp/test-control-socket' }, close() {} };
    },
    watch(watchedPath, options, callback) {
      const watcher = { callback, close() { watchers.delete(watchedPath); } };
      watchers.set(watchedPath, watcher);
      return watcher;
    },
  });

  assert.equal(installs, 1);
  assert.match(warnings[0], /fixture install failure/);
  assert.equal(watchers.has(path.join(project.dir, 'src')), true);
  assert.equal(watchers.has(path.join(project.dir, 'overlay')), true);

  watchers.get(path.join(project.dir, 'src')).callback('change', 'index.vue');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(installs, 2);
  assert.equal(deploys, 0);

  watchers.get(path.join(project.dir, 'src')).callback('change', 'index.vue');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(installs, 2);
  assert.equal(deploys, 1);

  controller.close();
});

test('router test reuses doctor capabilities and never exposes a session identifier', async function(t) {
  const cwd = makeTempDir('glplugin-router-test-');
  t.after(() => removeTempDir(cwd));
  const project = init('router-test-fixture', { cwd, log() {} });
  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.views = [
    { id: 'router-test-fixture', entry: 'src/index.vue', menu: 'menu.json' },
    { id: 'router-test-fixture-details', entry: 'src/index.vue', menu: 'menu-details.json' },
  ];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const bundle = zlib.gzipSync('(function(){return {name:"fixture",render:function(){}}})()');
  const inspectRouter = async (host, password, inspectOptions) => {
    assert.deepEqual(
      inspectOptions.requiredMenuViews,
      ['router-test-fixture', 'router-test-fixture-details']
    );
    return {
      ok: true,
      target: 'http://router.local',
      router: { model: 'GL-MT3000', firmware_version: '4.8.1' },
      compatibility: {
        compatible: true,
        status: 'live-supported',
        reason: 'fixture',
      },
      plugin: {
        menu_view: 'router-test-fixture',
        menu_loaded: true,
        menu_views: [
          { view: 'router-test-fixture', loaded: true },
          { view: 'router-test-fixture-details', loaded: true },
        ],
      },
      capabilities: [
        { id: 'wifi', status: 'available' },
        { id: 'dpi', status: 'unavailable' },
      ],
    };
  };
  const options = {
    cwd: project.dir,
    username: 'root',
    transportOptions: {},
    httpGet: async (host, urlPath) => ({
      status: 200,
      body: urlPath === '/' ? Buffer.from('admin') : bundle,
    }),
    inspectRouter,
  };
  const report = await verifyRouter('router.local', 'private-password', options);
  assert.equal(report.ok, true);
  assert.equal(report.checks.find((item) => item.id === 'plugin-export').status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'plugin-menu.router-test-fixture-details').status, 'pass');
  assert.equal(report.checks.find((item) => item.id === 'plugin-export.router-test-fixture-details').status, 'pass');
  assert.equal(report.capabilities.find((item) => item.id === 'dpi').testStatus, 'skip');
  assert.deepEqual(report.capabilitySummary, { available: 1, unavailable: 1 });
  assert.doesNotMatch(JSON.stringify(report), /private-password|sid|session/i);

  manifest.compatibility.requiredCapabilities = ['wifi', 'dpi'];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  const requiredReport = await verifyRouter('router.local', 'private-password', options);
  assert.equal(requiredReport.ok, false);
  assert.equal(
    requiredReport.checks.find((item) => item.id === 'required-capability.wifi').status,
    'pass'
  );
  assert.equal(
    requiredReport.checks.find((item) => item.id === 'required-capability.dpi').status,
    'fail'
  );
  assert.equal(requiredReport.capabilities.find((item) => item.id === 'dpi').required, true);
  assert.equal(requiredReport.capabilities.find((item) => item.id === 'dpi').testStatus, 'fail');
});
