'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('zlib');
const {
  MINIMUM_FIRMWARE,
  analyzeAdminBundle,
  compareFirmwareVersions,
  evaluateCompatibility,
  parseFirmwareVersion,
} = require('../lib/compatibility');
const { FIRMWARE_CATALOG } = require('../lib/firmware-catalog');
const { firmwareMatrix } = require('../scripts/firmware-matrix');
const {
  assertPlatformCompatibility,
  findAdminBundlePath,
  inspectPlatformViaHttp,
  inspectPlatformViaSsh,
} = require('../lib/platform');
const { compatiblePlatform } = require('./helpers');

const KNOWN_BUNDLE = '0409574b320a74de904a690df723134fc07471cddf5d622691ebbaa403116705';

function modernAnalysis(bundleSha256) {
  return {
    bundleSha256,
    contracts: { viewLoader: true, rpcRequest: true },
    portableComponents: ['gl-card', 'gl-title'],
    componentEvidence: 'runtime-vue-options-components',
  };
}

test('firmware policy has an explicit 4.8 minimum and numeric comparison', function() {
  assert.equal(MINIMUM_FIRMWARE, '4.8.0');
  assert.equal(parseFirmwareVersion('4.9.1 release1').normalized, '4.9.1');
  assert.equal(compareFirmwareVersions('4.8.0', '4.8'), 0);
  assert.equal(compareFirmwareVersions('4.8.1', '4.8.0'), 1);
  assert.equal(compareFirmwareVersions('4.7.10', '4.8.0'), -1);
});

test('known modern bundles are accepted while old and unknown bundles are not', function() {
  const known = evaluateCompatibility({
    analysis: modernAnalysis(KNOWN_BUNDLE),
    firmwareVersion: '4.8.1 release8',
    model: 'GL.iNet GL-MT3000',
    requiredComponents: ['gl-card', 'gl-title'],
  });
  assert.equal(known.compatible, true);
  assert.equal(known.status, 'live-supported');

  const wrongModel = evaluateCompatibility({
    analysis: modernAnalysis(KNOWN_BUNDLE),
    firmwareVersion: '4.8.1',
    model: 'GL-AXT1800',
  });
  assert.equal(wrongModel.compatible, false);
  assert.equal(wrongModel.status, 'unverified');
  assert.match(wrongModel.reason, /model and firmware tuple/);

  const wrongFirmware = evaluateCompatibility({
    analysis: modernAnalysis(KNOWN_BUNDLE),
    firmwareVersion: '4.9.1',
    model: 'GL-MT3000',
  });
  assert.equal(wrongFirmware.compatible, false);
  assert.equal(wrongFirmware.status, 'unverified');

  const old = evaluateCompatibility({
    analysis: modernAnalysis(KNOWN_BUNDLE),
    firmwareVersion: '4.7.10',
  });
  assert.equal(old.compatible, false);
  assert.equal(old.status, 'unsupported');
  assert.match(old.reason, /older than required/);

  const unknown = evaluateCompatibility({
    analysis: modernAnalysis('a'.repeat(64)),
    firmwareVersion: '4.9.2',
  });
  assert.equal(unknown.compatible, false);
  assert.equal(unknown.status, 'unverified');
});

test('admin bundle analysis keeps static registrations separate from runtime evidence', function() {
  const source = [
    'Vue.prototype.$rpcRequest=function(){};',
    'Vue.component("gl-card",Card);Vue.component("gl-title",Title);',
    'fetch(`/views/gl-sdk4-ui-${view}.common.js`).then(res=>eval(res.data));',
  ].join('');
  const analysis = analyzeAdminBundle(zlib.gzipSync(source));
  assert.deepEqual(analysis.contracts, { viewLoader: true, rpcRequest: true });
  assert.deepEqual(analysis.portableComponents, []);
  assert.deepEqual(analysis.staticPortableComponents, ['gl-card', 'gl-title']);
  assert.equal(analysis.componentEvidence, 'unverified-static-signals');
  assert.equal(analysis.bundleSha256.length, 64);
});

test('required components need runtime registry evidence', function() {
  const result = evaluateCompatibility({
    analysis: {
      bundleSha256: KNOWN_BUNDLE,
      contracts: { viewLoader: true, rpcRequest: true },
      portableComponents: [],
      staticPortableComponents: ['gl-card'],
      componentEvidence: 'unverified-static-signals',
    },
    firmwareVersion: '4.8.1',
    model: 'GL-MT3000',
    requiredComponents: ['gl-card'],
  });
  assert.equal(result.compatible, false);
  assert.equal(result.status, 'incompatible');
  assert.match(result.reason, /runtime registry evidence/);
});

test('strict preflight blocks unknown bundles unless the override is explicit', function() {
  const manifest = {
    package: { architecture: 'all' },
  };
  const unverified = compatiblePlatform({
    compatibility: {
      compatible: false,
      status: 'unverified',
      reason: 'unknown exact bundle',
    },
  });
  assert.throws(
    () => assertPlatformCompatibility(unverified, manifest),
    /unknown exact bundle/
  );
  const allowed = assertPlatformCompatibility(unverified, manifest, { allowUnverified: true });
  assert.equal(allowed.compatibility.override, 'allow-unverified');

  const broken = compatiblePlatform({ fileChecks: { opkg: true } });
  assert.throws(
    () => assertPlatformCompatibility(broken, manifest),
    /\/www\/views is unavailable/
  );
});

test('HTTP platform inspection fingerprints the exact app bundle referenced by the admin page', async function() {
  const source = [
    'Vue.prototype.$rpcRequest=function(){};',
    'Vue.component("gl-card",Card);Vue.component("gl-title",Title);',
    'fetch(`/views/gl-sdk4-ui-${view}.common.js`).then(res=>eval(res.data));',
  ].join('');
  const archive = zlib.gzipSync(source);
  const requests = [];
  const report = await inspectPlatformViaHttp('router.local', {
    httpGet: async function(host, requestPath) {
      requests.push(requestPath);
      if (requestPath === '/') {
        return {
          status: 200,
          body: Buffer.from('<script src="/js/app.fixture.js"></script>'),
        };
      }
      return { status: 200, body: archive };
    },
  });
  assert.equal(findAdminBundlePath('<script src="/js/app.abc.js"></script>'), '/js/app.abc.js');
  assert.equal(report.appPath, '/js/app.fixture.js');
  assert.deepEqual(requests, ['/', '/js/app.fixture.js.gz']);
  assert.equal(report.analysis.contracts.rpcRequest, true);
});

test('SSH platform inspection maps the public app URL to the /www filesystem', function() {
  const source = [
    'Vue.prototype.$rpcRequest=function(){};',
    'Vue.component("gl-card",Card);Vue.component("gl-title",Title);',
    'fetch(`/views/gl-sdk4-ui-${view}.common.js`).then(res=>eval(res.data));',
  ].join('');
  const commands = [];
  const report = inspectPlatformViaSsh('root@router.local', {
    sshCapture(target, command) {
      commands.push(command);
      if (command === 'cat /etc/glversion') return Buffer.from('4.8.1-release8');
      if (command === 'ubus call system board') return Buffer.from('{"model":"GL-MT3000"}');
      if (command === 'cat /www/gl_home.html') {
        return Buffer.from('<script src="/js/app.fixture.js"></script>');
      }
      if (command === 'cat /www/js/app.fixture.js.gz') return zlib.gzipSync(source);
      if (command === 'opkg print-architecture') return Buffer.from('arch all 1\narch test 10\n');
      if (command === 'opkg status gl-sdk4-ui-core') {
        return Buffer.from('Package: gl-sdk4-ui-core\nArchitecture: test\n');
      }
      if (command.startsWith('df -Pk')) {
        return Buffer.from('Filesystem 1024-blocks Used Available Capacity Mounted on\n' +
          'overlay 100000 1000 99000 1% /overlay\n');
      }
      return Buffer.from([
        'opkg=1', 'views=1', 'menus=1', 'functions=1',
        'postinst=1', 'postinst_pkg=1', 'prerm=1', 'prerm_pkg=1',
      ].join('\n'));
    },
    requiredComponents: ['gl-card', 'gl-title'],
  });
  assert.equal(report.errors.length, 0);
  assert.equal(report.analysis.contracts.rpcRequest, true);
  assert.equal(report.compatibility.status, 'incompatible');
  assert.match(report.compatibility.reason, /runtime registry evidence/);
  assert.equal(commands.includes('cat /www/js/app.fixture.js.gz'), true);
});

test('SSH platform inspection does not certify an unreferenced app bundle', function() {
  const commands = [];
  const report = inspectPlatformViaSsh('root@router.local', {
    sshCapture(target, command) {
      commands.push(command);
      if (command === 'cat /etc/glversion') return Buffer.from('4.8.1-release8');
      if (command === 'ubus call system board') return Buffer.from('{"model":"GL-MT3000"}');
      if (command === 'cat /www/gl_home.html') return Buffer.from('<html></html>');
      if (command === 'opkg print-architecture') return Buffer.from('arch all 1\n');
      if (command === 'opkg status gl-sdk4-ui-core') {
        return Buffer.from('Package: gl-sdk4-ui-core\nArchitecture: all\n');
      }
      if (command.startsWith('df -Pk')) {
        return Buffer.from('Filesystem 1024-blocks Used Available Capacity Mounted on\n' +
          'overlay 100000 1000 99000 1% /overlay\n');
      }
      return Buffer.from([
        'opkg=1', 'views=1', 'menus=1', 'functions=1',
        'postinst=1', 'postinst_pkg=1', 'prerm=1', 'prerm_pkg=1',
      ].join('\n'));
    },
  });
  assert.equal(report.compatibility.status, 'unsupported');
  assert.equal(report.errors.some((error) => (
    error.id === 'admin-home' && /not referenced/.test(error.message)
  )), true);
  assert.equal(commands.some((command) => command.includes('/www/js/app.')), false);
});

test('official firmware catalog contains unique modern release fingerprints', function() {
  assert.equal(new Set(FIRMWARE_CATALOG.map((entry) => entry.id)).size, FIRMWARE_CATALOG.length);
  assert.equal(
    new Set(FIRMWARE_CATALOG.map((entry) => entry.appBundleSha256)).size,
    FIRMWARE_CATALOG.length
  );
  FIRMWARE_CATALOG.forEach((entry) => {
    assert.notEqual(compareFirmwareVersions(entry.firmware, MINIMUM_FIRMWARE), -1);
    assert.match(entry.artifact.url, /^https:\/\/fw\.gl-inet\.com\/firmware\//);
    assert.match(entry.artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(Array.isArray(entry.portableComponents), true);
    assert.equal(Array.isArray(entry.staticPortableComponents), true);
    if (entry.lineChartContract) {
      assert.equal(entry.lineChartContract, 'gl-line-chart-v1');
    }
  });
});

test('firmware CI matrix is generated from the runtime catalog', function() {
  assert.deepEqual(firmwareMatrix(), {
    include: FIRMWARE_CATALOG.map((entry) => ({
      id: entry.id,
      sha256: entry.artifact.sha256,
    })),
  });
  const workflow = require('fs').readFileSync(
    require('path').resolve(__dirname, '..', '.github', 'workflows', 'ci.yml'),
    'utf8'
  );
  assert.match(workflow, /node scripts\/firmware-matrix\.js/);
  FIRMWARE_CATALOG.forEach((entry) => assert.doesNotMatch(workflow, new RegExp(entry.id)));
});
