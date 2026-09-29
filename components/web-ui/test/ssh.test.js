'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const zlib = require('zlib');
const deploy = require('../lib/deploy');
const extract = require('../lib/extract');
const init = require('../lib/init');
const {
  normalizeSshTarget,
  scpUpload,
  sshCapture,
  validateLocalPath,
  validateRemoteFilename,
  validateRemotePath,
} = require('../lib/ssh-transport');
const { compatiblePlatform, makeTempDir, removeTempDir } = require('./helpers');

function successful(stdout) {
  return { status: 0, stdout: stdout || Buffer.alloc(0), stderr: Buffer.alloc(0) };
}

test('SSH targets and legacy SCP paths reject option and shell injection', function() {
  assert.deepEqual(normalizeSshTarget('router.local'), {
    host: 'router.local', target: 'root@router.local', user: 'root',
  });
  assert.deepEqual(normalizeSshTarget('admin@[fe80::1]'), {
    host: '[fe80::1]', target: 'admin@[fe80::1]', user: 'admin',
  });

  [
    '-oProxyCommand=touch /tmp/pwned',
    'router.local;touch-x',
    'root@router.local:/tmp/file',
    'root@router.local $(id)',
    'root@@router.local',
  ].forEach((target) => assert.throws(() => normalizeSshTarget(target), /Invalid SSH target/));

  assert.equal(validateRemotePath('/www/views/plugin.js'), '/www/views/plugin.js');
  assert.throws(() => validateRemotePath('/www/../etc/passwd'), /normalized absolute/);
  assert.throws(() => validateRemotePath('/www/file;reboot'), /normalized absolute/);
  assert.equal(validateRemoteFilename('gl-sdk4-ui-demo.en.json'), 'gl-sdk4-ui-demo.en.json');
  assert.throws(() => validateRemoteFilename('demo;reboot.json'), /Unsafe remote filename/);
  assert.equal(validateLocalPath('/tmp/local file.js'), '/tmp/local file.js');
  assert.throws(() => validateLocalPath('-oProxyCommand=touch-x'), /must be absolute/);
});

test('SSH transport passes exact argv to spawnSync without a local shell', function() {
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ args, command, options });
    return successful(Buffer.from('router output'));
  };

  scpUpload(
    'router.local',
    '/tmp/local file.js',
    '/www/views/plugin.js',
    { spawnSync }
  );
  const output = sshCapture(
    'root@router.local',
    'cat /etc/glversion',
    { insecureHostKey: true, spawnSync }
  );

  assert.equal(output.toString(), 'router output');
  assert.deepEqual(calls[0].args, [
    '-O', '-o', 'StrictHostKeyChecking=accept-new',
    '/tmp/local file.js', 'root@router.local:/www/views/plugin.js',
  ]);
  assert.deepEqual(calls[1].args, [
    '-o', 'StrictHostKeyChecking=no', 'root@router.local', 'cat /etc/glversion',
  ]);
  calls.forEach((call) => assert.equal(call.options.shell, false));
});

test('deploy preflights inputs and uploads every asset through argument arrays', function(t) {
  const cwd = makeTempDir('glplugin-deploy-');
  t.after(() => removeTempDir(cwd));
  const project = init('deploy-fixture', { cwd });
  fs.mkdirSync(path.join(project.dir, 'dist'));
  fs.writeFileSync(
    path.join(project.dir, 'dist', 'gl-sdk4-ui-deploy-fixture.common.js.gz'),
    'bundle'
  );
  fs.writeFileSync(
    path.join(project.dir, 'dist', 'gl-sdk4-ui-deploy-fixture-tools.common.js.gz'),
    'tools bundle'
  );
  fs.mkdirSync(path.join(project.dir, 'menus'));
  fs.writeFileSync(path.join(project.dir, 'menus', 'tools.json'), JSON.stringify({
    index: 21,
    view: 'deploy-fixture-tools',
    title: 'Tools',
    icon: 'setting',
    level: 1,
  }) + '\n');
  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.views = [
    { id: 'deploy-fixture', entry: 'src/index.vue', menu: 'menu.json' },
    { id: 'deploy-fixture-tools', entry: 'src/index.vue', menu: 'menus/tools.json' },
  ];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ args, command, options });
    return successful();
  };
  const result = deploy(['router.local'], {
    cwd: project.dir,
    inspectPlatform() { return compatiblePlatform(); },
    log() {},
    spawnSync,
  });

  assert.equal(result.target, 'root@router.local');
  assert.equal(result.uploaded, 5);
  assert.equal(result.compatibility.status, 'live-supported');
  assert.deepEqual(
    calls.map((call) => call.command),
    ['ssh', 'ssh', 'scp', 'scp', 'scp', 'scp', 'ssh', 'scp', 'ssh', 'scp', 'ssh', 'ssh']
  );
  calls.forEach((call) => {
    assert.equal(call.options.shell, false);
  });
  assert.equal(calls[0].args.includes('ControlMaster=yes'), true);
  assert.equal(calls[0].args.includes('StrictHostKeyChecking=accept-new'), true);
  calls.slice(1, -1).forEach((call) => {
    assert.equal(call.args.some((arg) => arg.startsWith('ControlPath=')), true);
    assert.equal(call.args.includes('ControlMaster=no'), true);
  });
  assert.equal(calls.at(-1).args.includes('-O'), true);
  assert.equal(calls.at(-1).args.includes('exit'), true);

  fs.writeFileSync(path.join(project.dir, 'i18n', 'bad;touch.json'), '{}\n');
  let unsafeCalls = 0;
  assert.throws(() => deploy(['router.local'], {
    cwd: project.dir,
    log() {},
    spawnSync() {
      unsafeCalls += 1;
      return successful();
    },
  }), /Unsafe remote filename/);
  assert.equal(unsafeCalls, 0);

  fs.rmSync(path.join(project.dir, 'i18n', 'bad;touch.json'));
  fs.writeFileSync(path.join(project.dir, 'i18n', 'core.en.json'), '{}\n');
  assert.throws(() => deploy(['router.local'], {
    cwd: project.dir,
    log() {},
    spawnSync() {
      unsafeCalls += 1;
      return successful();
    },
  }), /must start with "gl-sdk4-ui-deploy-fixture\."/);
  assert.equal(unsafeCalls, 0);
});

test('deploy removes only stale assets recorded in its project inventory', function(t) {
  const cwd = makeTempDir('glplugin-deploy-cleanup-');
  t.after(() => removeTempDir(cwd));
  const project = init('cleanup-fixture', { cwd, log() {} });
  fs.mkdirSync(path.join(project.dir, 'dist'));
  fs.writeFileSync(
    path.join(project.dir, 'dist', 'gl-sdk4-ui-cleanup-fixture.common.js.gz'),
    'bundle'
  );
  const stale = [
    '/www/views/gl-sdk4-ui-cleanup-fixture-old.common.js.gz',
    '/usr/share/oui/menu.d/cleanup-fixture-old.json',
    '/www/i18n/gl-sdk4-ui-cleanup-fixture.fr.json',
  ];
  const hostile = '/www/views/gl-sdk4-ui-cleanup-fixture-old;reboot.common.js.gz';
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    const remoteCommand = args.at(-1);
    if (command === 'ssh' && /^cat .*deploy-state/.test(remoteCommand)) {
      return successful(Buffer.from(stale.concat('/etc/passwd', hostile).join('\n') + '\n'));
    }
    return successful();
  };

  const result = deploy(['router.local'], {
    cwd: project.dir,
    inspectPlatform() { return compatiblePlatform(); },
    log() {},
    spawnSync,
  });
  const remoteCommands = calls
    .filter((call) => call.command === 'ssh')
    .map((call) => call.args.at(-1));
  stale.forEach((file) => assert.equal(remoteCommands.includes(`rm -f ${file}`), true));
  assert.equal(remoteCommands.includes('rm -f /etc/passwd'), false);
  assert.equal(remoteCommands.includes(`rm -f ${hostile}`), false);
  assert.deepEqual(result.removed, stale);
  assert.equal(calls.some((call) => (
    call.command === 'scp' && call.args.some((arg) => /deploy-state.*\.tmp-/.test(arg))
  )), true);
});

test('SSH extraction analyzes a gzipped bundle and framed menu documents', function() {
  const source = [
    '"gl-button"',
    'var(--primary-color)',
    'icon:"setting"',
    '"call",["sid","system","get_info"',
  ].join(';');
  const bundle = zlib.gzipSync(source);
  const menus = Buffer.from('{"view":"one"}\0[{"view":"two"}]\0');
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ args, command, options });
    if (args.includes('ControlMaster=yes')) return successful();
    if (args.includes('-O') && args.includes('exit')) return successful();
    const remoteCommand = args[args.length - 1];
    if (remoteCommand === extract.APP_BUNDLE_COMMAND) return successful(bundle);
    if (remoteCommand === extract.MENU_COMMAND) return successful(menus);
    if (remoteCommand === extract.FIRMWARE_COMMAND) return successful(Buffer.from('4.8.1\n'));
    return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('unexpected command') };
  };

  const result = extract.extractViaSsh('router.local', { spawnSync });
  assert.deepEqual(result.components, []);
  assert.equal(result.bundleCatalog.status, 'unknown-bundle');
  assert.deepEqual(result.bundleCatalog.matches, []);
  assert.equal(result.componentRegistry.status, 'unknown');
  assert.equal(result.componentRegistry.uiComponentCount, 0);
  assert.deepEqual(result.literalComponentRegistrations, []);
  assert.deepEqual(result.cssVariables, ['--primary-color']);
  assert.deepEqual(result.icons, ['setting']);
  assert.deepEqual(result.rpcMethodsInCode, ['system.get_info']);
  assert.deepEqual(result.menus, [{ view: 'one' }, { view: 'two' }]);
  assert.equal(result.firmware, '4.8.1');
  assert.deepEqual(result.sshErrors, []);
  assert.equal(calls.length, 5);
  assert.equal(calls[0].args.includes('ControlMaster=yes'), true);
  assert.equal(calls.at(-1).args.includes('exit'), true);
  calls.forEach((call) => assert.equal(call.options.shell, false));
});

test('bundle analysis separates verified registry data from static string signals', function() {
  const source = [
    'Vue.component("gl-real",Component)',
    '"gl-css-class"',
    'var(--primary-color)',
  ].join(';');
  const sha256 = require('crypto').createHash('sha256').update(source).digest('hex');
  const componentCatalogs = [{
    id: 'synthetic-runtime-catalog',
    model: 'TEST',
    firmware: '1.0.0',
    channel: 'test',
    bundleSha256: sha256,
    evidence: 'runtime-vue-options-components',
    uiComponents: [{
      registryKey: 'GlReal', tag: 'gl-real', origin: 'test', usage: 'standalone', requiresParent: null,
    }],
    routerComponents: [],
  }];

  const verified = extract.analyzeAdminBundle(source, { componentCatalogs });
  assert.equal(verified.componentRegistry.status, 'verified');
  assert.deepEqual(verified.components, ['gl-real']);
  assert.deepEqual(verified.literalComponentRegistrations, ['gl-real']);

  const unknown = extract.analyzeAdminBundle('"gl-css-class";Vue.use(Component)');
  assert.equal(unknown.componentRegistry.status, 'unknown');
  assert.deepEqual(unknown.components, []);
  assert.deepEqual(unknown.literalComponentRegistrations, []);
});

test('official component catalogs contain exact runtime registry snapshots', function() {
  const { CATALOGS, canonicalTag, findComponentCatalog } = require('../lib/component-catalog');
  const release = findComponentCatalog(
    '0409574b320a74de904a690df723134fc07471cddf5d622691ebbaa403116705'
  );
  const beta = findComponentCatalog(
    'd85b8cf6573572bbe4ba096a8c6f7043c7c2cd1df5541933c6b83192f05240c7'
  );

  assert.equal(CATALOGS.length, 2);
  assert.equal(release.uiComponents.length, 52);
  assert.equal(release.routerComponents.length, 2);
  assert.equal(beta.uiComponents.length, 57);
  assert.equal(beta.routerComponents.length, 2);
  assert.equal(canonicalTag('ElTabPane'), 'el-tab-pane');
  assert.equal(canonicalTag('RouterView'), 'router-view');
  assert.equal(
    release.uiComponents.find((entry) => entry.registryKey === 'GlCheckbox').requiresParent,
    'gl-checkbox-group'
  );
  assert.deepEqual(
    beta.uiComponents
      .map((entry) => entry.tag)
      .filter((tag) => !release.uiComponents.some((entry) => entry.tag === tag)),
    ['gl-agree-check', 'gl-number-input', 'gl-otp-input', 'gl-select-timezone', 'gl-steps']
  );
});

test('RPC extraction does not print or persist credentials and redacts response secrets', async function(t) {
  const cwd = makeTempDir('glplugin-extract-rpc-');
  t.after(() => removeTempDir(cwd));
  const logs = [];
  const logouts = [];
  const result = await extract(['root@router.local', '--rpc', '--password-stdin'], {
    call: async (host, sid, module, method) => {
      assert.equal(host, 'router.local');
      assert.equal(sid, 'private-session-id');
      return module === 'system' && method === 'get_info'
        ? {
          firmware_version: '4.9.0',
          nested: { private_key: 'private-key-value', token: 'private-token' },
          passwd: 'wifi-password',
        }
        : null;
    },
    cwd,
    log(value) { logs.push(value); },
    login: async () => ({ sid: 'private-session-id' }),
    logout: async (host, sid, options) => {
      logouts.push({ host, sid, options });
    },
    now: () => new Date('2026-08-15T00:00:00.000Z'),
    readRouterPassword: async () => 'private-password',
  });

  const persisted = fs.readFileSync(result.outFile, 'utf8');
  assert.doesNotMatch(logs.join('\n'), /private-session-id|private-password/);
  assert.doesNotMatch(
    persisted,
    /private-session-id|private-password|private-key-value|private-token|wifi-password/
  );
  assert.equal(result.result.apiResponses['system.get_info'].passwd, '<redacted>');
  assert.deepEqual(result.result.apiResponses['system.get_info'].nested, {
    private_key: '<redacted>', token: '<redacted>',
  });
  assert.equal(result.result.firmware, '4.9.0');
  assert.deepEqual(result.result.confirmedMethods, ['system.get_info']);
  assert.deepEqual(logouts, [{
    host: 'router.local',
    sid: 'private-session-id',
    options: { https: false, insecure: false },
  }]);
});

test('RPC extraction resolves a configured target and applies its transport defaults', async function(t) {
  const cwd = makeTempDir('glplugin-extract-target-');
  t.after(() => removeTempDir(cwd));
  let loginCall;
  let logoutCall;
  const result = await extract(['--rpc'], {
    call: async (host, sid, module, method, params, transport) => {
      assert.equal(host, 'rpc.router.local');
      assert.equal(sid, 'session');
      assert.deepEqual(transport, { https: true, insecure: true });
      return module === 'system' && method === 'get_info' ? { firmware_version: '4.9.0' } : null;
    },
    cwd,
    log() {},
    login: async (...args) => {
      loginCall = args;
      return { sid: 'session' };
    },
    logout: async (...args) => {
      logoutCall = args;
    },
    readRouterPassword: async () => 'private-password',
    resolveTarget() {
      return {
        ssh: 'root@router.local',
        rpcHost: 'rpc.router.local',
        username: 'admin',
        https: true,
        insecure: true,
        insecureHostKey: false,
      };
    },
  });
  assert.equal(loginCall[0], 'rpc.router.local');
  assert.equal(loginCall[2], 'admin');
  assert.deepEqual(loginCall[3], { https: true, insecure: true });
  assert.deepEqual(logoutCall, [
    'rpc.router.local', 'session', { https: true, insecure: true },
  ]);
  assert.equal(result.result.firmware, '4.9.0');
});

test('deploy and extract parsers reject unknown flags and extra positionals', function() {
  assert.deepEqual(deploy.parseDeployArgs(['router.local', '--insecure-host-key']), {
    host: 'router.local', build: false, hostKeyPolicy: 'insecure', allowUnverified: false,
  });
  assert.deepEqual(deploy.parseDeployArgs(['router.local', '--build', '--strict-host-key']), {
    host: 'router.local', build: true, hostKeyPolicy: 'strict', allowUnverified: false,
  });
  assert.throws(() => deploy.parseDeployArgs(['router.local', '--port', '22']), /Unknown/);
  assert.equal(extract.parseExtractArgs(['router.local', '--full']).sshMode, true);
  assert.equal(extract.parseExtractArgs(['router.local', '--full']).rpcMode, true);
  assert.equal(
    extract.parseExtractArgs(['router.local', '--rpc', '--include-sensitive']).includeSensitive,
    true
  );
  assert.throws(
    () => extract.parseExtractArgs(['router.local', '--include-sensitive']),
    /require --rpc/
  );
  assert.throws(
    () => extract.parseExtractArgs(['router.local', '--rpc', '--insecure-host-key']),
    /requires SSH mode/
  );
  assert.throws(() => extract.parseExtractArgs(['router.local', '--unknown']), /Unknown/);
});

test('RPC response sanitizer preserves shape while redacting known secret fields', function() {
  assert.deepEqual(extract.sanitizeApiValue({
    enabled: true,
    peers: [{ auth_token: 'token', public_key: 'public', presharedkey: 'shared' }],
    wifi: { key: 'wifi-secret', ssid: 'Guest' },
  }), {
    enabled: true,
    peers: [{ auth_token: '<redacted>', public_key: 'public', presharedkey: '<redacted>' }],
    wifi: { key: '<redacted>', ssid: 'Guest' },
  });
});
