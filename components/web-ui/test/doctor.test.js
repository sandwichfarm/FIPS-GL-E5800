'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { RpcError } = require('../lib/auth');
const doctor = require('../lib/doctor');
const { formatDoctorReport, inspectRouter, menuContainsView } = doctor;
const init = require('../lib/init');
const { applyRouterTarget, parseRouterArgs } = require('../lib/router-command');
const { makeTempDir, removeTempDir } = require('./helpers');

test('doctor reports model, firmware, auth, and feature-gated capabilities', async function() {
  const calls = [];
  const logouts = [];
  const report = await inspectRouter('192.0.2.1', 'fixture-password', {
    username: 'root',
    requiredCapabilities: ['wifi'],
    requiredMenuViews: ['fixture-main', 'fixture-tools'],
    login: async function() {
      return { sid: 'private-session', auth: { alg: '6', name: 'sha512-crypt' } };
    },
    logout: async function(host, sid, options) {
      logouts.push({ host, sid, options });
    },
    inspectPlatform: async function() {
      return {
        source: 'test-fixture',
        appPath: '/js/app.fixture.js',
        analysis: {
          bundleSha256: '0409574b320a74de904a690df723134fc07471cddf5d622691ebbaa403116705',
          contracts: { viewLoader: true, rpcRequest: true },
          portableComponents: ['gl-card', 'gl-title'],
        },
      };
    },
    call: async function(host, sid, module, method) {
      calls.push(`${module}.${method}`);
      assert.equal(sid, 'private-session');
      if (module === 'system' && method === 'get_info') {
        return {
          board_info: {
            model: 'GL-MT3000',
            hostname: 'beryl-ax',
            architecture: 'ARMv8',
            kernel_version: '5.4.211',
            openwrt_version: 'OpenWrt 21.02-SNAPSHOT',
          },
          firmware_version: '4.8.1',
          firmware_type: 'testing',
          software_feature: { vpn: true, adguard: false, ipv6: true, tor: false },
          hardware_feature: { fan: false, build_in_modem: '' },
        };
      }
      if (module === 'system' && method === 'get_status') return { system: { mode: 0 } };
      if (module === 'ui' && method === 'get_menu_list') {
        return {
          menus: [
            { view: 'fixture-main' },
            { view: 'applications', children: [{ view: 'fixture-tools' }] },
          ],
        };
      }
      if (module === 'sqm' || module === 'dpi' || module === 'tailscale') {
        throw new RpcError('Method not found', { code: -32601 });
      }
      return {};
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.router.model, 'GL-MT3000');
  assert.equal(report.router.firmware_version, '4.8.1');
  assert.equal(report.router.sdk_generation, 'SDK4 modern');
  assert.equal(report.compatibility.status, 'live-supported');
  assert.deepEqual(report.auth, { alg: '6', name: 'sha512-crypt' });
  assert.equal(report.capabilities.find((item) => item.id === 'adguardhome').status, 'not-supported');
  assert.equal(report.capabilities.find((item) => item.id === 'fan').status, 'not-supported');
  assert.equal(report.capabilities.find((item) => item.id === 'dpi').status, 'unavailable');
  assert.equal(report.capabilities.find((item) => item.id === 'wifi').status, 'available');
  assert.equal(report.capability_contract.satisfied, true);
  assert.deepEqual(report.capability_contract.required, ['wifi']);
  assert.equal(report.plugin.menu_loaded, true);
  assert.deepEqual(report.plugin.menu_views, [
    { view: 'fixture-main', loaded: true },
    { view: 'fixture-tools', loaded: true },
  ]);
  assert.equal(calls.includes('adguardhome.get_config'), false);
  assert.equal(calls.includes('fan.get_status'), false);
  assert.deepEqual(logouts, [{
    host: '192.0.2.1',
    sid: 'private-session',
    options: {
      https: undefined,
      insecure: undefined,
      timeout: undefined,
      transport: undefined,
      spawnSync: undefined,
    },
  }]);
  assert.doesNotMatch(JSON.stringify(report), /private-session|fixture-password/);
  assert.match(formatDoctorReport(report), /Firmware: 4\.8\.1 \(testing\)/);
  assert.match(formatDoctorReport(report), /Deep Packet Inspection \(4\.9\+\): unavailable/);
  assert.match(formatDoctorReport(report), /Required capabilities[\s\S]*\[PASS\] wifi: available/);
  assert.match(formatDoctorReport(report), /Menu view fixture-tools: loaded/);
});

test('doctor attempts logout after RPC failure without masking the original report', async function() {
  let logoutCalls = 0;
  const report = await inspectRouter('router.test', 'fixture-password', {
    login: async () => ({ sid: 'private-session', auth: { alg: '1', name: 'md5-crypt' } }),
    call: async () => {
      throw new Error('core RPC failed');
    },
    logout: async () => {
      logoutCalls += 1;
      throw new Error('logout failed');
    },
  });

  assert.equal(logoutCalls, 1);
  assert.equal(report.ok, false);
  assert.deepEqual(report.errors.map((error) => error.rpc), [
    'system.get_info',
    'system.get_status',
    'session.logout',
  ]);
  assert.doesNotMatch(JSON.stringify(report), /private-session|fixture-password/);
});

test('doctor loads required capabilities from the current plugin manifest', async function(t) {
  const cwd = makeTempDir('glplugin-doctor-project-');
  t.after(() => removeTempDir(cwd));
  const project = init('doctor-project', { cwd, log() {} });
  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.compatibility.requiredCapabilities = ['wifi', 'repeater'];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  const report = {
    ok: true,
    target: 'http://router.local',
    auth: { alg: '1', name: 'md5-crypt' },
    transport: { tls_verification: 'not-applicable' },
    router: { model: 'GL-MT3000' },
    compatibility: { compatible: true, status: 'live-supported' },
    capability_contract: { required: ['wifi', 'repeater'], satisfied: true, checks: [] },
    capabilities: [],
    errors: [],
    summary: {},
  };
  const result = await doctor([], {
    cwd: project.dir,
    json: true,
    resolveTarget() {
      return {
        rpcHost: 'router.local', username: 'root', https: false, insecure: false,
      };
    },
    readRouterPassword: async () => 'private-password',
    inspectRouter: async (host, password, options) => {
      assert.equal(host, 'router.local');
      assert.equal(password, 'private-password');
      assert.deepEqual(options.requiredComponents, ['gl-card', 'gl-title']);
      assert.deepEqual(options.requiredCapabilities, ['wifi', 'repeater']);
      return report;
    },
  });
  assert.equal(result, report);
});

test('router CLI arguments reject positional passwords', function() {
  assert.deepEqual(parseRouterArgs([
    'router.local', '--https', '--insecure', '--username', 'admin', '--password-stdin', '--json',
  ], { allowJson: true }), {
    host: 'router.local',
    username: 'admin',
    https: true,
    insecure: true,
    allowUnverified: false,
    json: true,
    passwordStdin: true,
  });
  assert.throws(() => parseRouterArgs(['router.local', 'secret']), /Passwords and extra positional/);

  const defaults = applyRouterTarget(
    parseRouterArgs([], { allowMissingHost: true }),
    {
      rpcHost: 'configured.local', username: 'admin', https: true, insecure: true,
    }
  );
  assert.equal(defaults.host, 'configured.local');
  assert.equal(defaults.username, 'admin');
  assert.equal(defaults.https, true);
  assert.equal(defaults.insecure, true);

  const overrides = applyRouterTarget(
    parseRouterArgs(['--http', '--secure'], { allowMissingHost: true }),
    {
      rpcHost: 'configured.local', username: 'admin', https: true, insecure: true,
    }
  );
  assert.equal(overrides.https, false);
  assert.equal(overrides.insecure, false);
});

test('menu verification finds nested plugin entries without relying on client history', function() {
  const result = {
    menus: [
      { view: 'overview' },
      { view: 'applications', children: [{ view: 'router-tool' }] },
    ],
  };
  assert.equal(menuContainsView(result, 'router-tool'), true);
  assert.equal(menuContainsView(result, 'missing-plugin'), false);
});
