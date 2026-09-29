'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const test = require('node:test');
const cli = require('../lib/cli');
const {
  captureCandidate,
  verifyCandidate,
} = require('../lib/compatibility-candidate');
const { makeTempDir, removeTempDir } = require('./helpers');

const PORTABLE_COMPONENTS = [
  'gl-button', 'gl-card', 'gl-line-chart', 'gl-tips', 'gl-title',
];

function doctorReport(overrides) {
  const report = {
    ok: false,
    checked_at: '2026-08-16T10:00:00.000Z',
    target: 'http://private-router.local',
    transport: { protocol: 'http' },
    auth: { alg: '1', name: 'md5-crypt', sid: 'private-session' },
    router: {
      model: 'GL.iNet GL-BE9300',
      hostname: 'private-hostname',
      firmware_version: '4.9.2 release1',
      firmware_type: 'release1',
      architecture: 'ARMv8 Processor rev 4',
      openwrt_version: 'OpenWrt 23.05-SNAPSHOT ',
    },
    compatibility: {
      compatible: false,
      status: 'unverified',
      runtimeContract: 'sdk4-modern-v1',
      firmware: '4.9.2',
      model: 'GL.iNet GL-BE9300',
      bundleSha256: 'a'.repeat(64),
      portableComponents: [],
      staticPortableComponents: PORTABLE_COMPONENTS,
      componentEvidence: 'unverified-static-signals',
      source: 'http-admin-bundle',
      app_path: '/js/app.private.js',
    },
    capabilities: [{ id: 'wifi', status: 'available', secret: 'private-capability' }],
    errors: [],
    ...(overrides || {}),
  };
  return {
    ok: false,
    error: {
      message: 'Router doctor failed its compatibility checks.',
      exitCode: 4,
      details: report,
    },
  };
}

function bundleFixture() {
  return Buffer.from([
    'Vue.prototype.$rpcRequest=function(){};',
    ...PORTABLE_COMPONENTS.map((name) => `Vue.component("${name}",Component);`),
    'fetch(`/views/gl-sdk4-ui-${view}.common.js`).then(res=>eval(res.data));',
  ].join(''));
}

function candidateForBundle(bundle, report) {
  const candidate = captureCandidate(report || doctorReport());
  candidate.runtime.bundleSha256 = crypto.createHash('sha256').update(bundle).digest('hex');
  return candidate;
}

function memoryStream() {
  return {
    value: '',
    write(chunk) { this.value += String(chunk); },
  };
}

test('capture creates a minimal redacted candidate from failed doctor JSON', function() {
  const candidate = captureCandidate(doctorReport());

  assert.deepEqual(candidate, {
    schemaVersion: 1,
    kind: 'gl-sdk4-compatibility-candidate',
    capturedAt: '2026-08-16T10:00:00.000Z',
    router: {
      model: 'GL-BE9300',
      firmware: '4.9.2',
      firmwareType: 'release1',
      architecture: 'ARMv8 Processor rev 4',
      openwrtVersion: 'OpenWrt 23.05-SNAPSHOT',
    },
    runtime: {
      contract: 'sdk4-modern-v1',
      bundleSha256: 'a'.repeat(64),
      componentEvidence: 'unverified-static-signals',
      staticPortableComponents: PORTABLE_COMPONENTS,
    },
    evidence: {
      source: 'http-admin-bundle',
      compatibilityStatus: 'unverified',
    },
  });

  const serialized = JSON.stringify(candidate);
  assert.doesNotMatch(serialized, /private-router|private-hostname|private-session/);
  assert.doesNotMatch(serialized, /private-capability|app\.private/);
  assert.doesNotMatch(serialized, /auth|target|capabilities/i);
});

test('verify marks a complete unknown tuple ready for manual review', function() {
  const bundle = bundleFixture();
  const candidate = candidateForBundle(bundle);
  const result = verifyCandidate(candidate, { bundle });

  assert.equal(result.ready, true);
  assert.equal(result.status, 'ready-for-review');
  assert.equal(result.catalogMatch, null);
  assert.deepEqual(result.errors, []);
  assert.equal(result.catalogHint, undefined);
});

test('verify rejects incomplete or unsupported runtime evidence', function() {
  const bundle = bundleFixture();
  const base = candidateForBundle(bundle);
  const cases = [
    {
      id: 'runtime-contract',
      candidate: { ...base, runtime: { ...base.runtime, contract: 'legacy' } },
    },
    {
      id: 'bundle-sha256',
      candidate: { ...base, runtime: { ...base.runtime, bundleSha256: 'not-a-sha' } },
    },
    {
      id: 'static-portable-components',
      candidate: {
        ...base,
        runtime: { ...base.runtime, staticPortableComponents: ['gl-card', 'gl-title'] },
      },
    },
    {
      id: 'minimum-firmware',
      candidate: { ...base, router: { ...base.router, firmware: '4.7.10' } },
    },
    {
      id: 'evidence-status',
      candidate: {
        ...base,
        evidence: { ...base.evidence, compatibilityStatus: 'unsupported' },
      },
    },
  ];

  cases.forEach(({ id, candidate }) => {
    const result = verifyCandidate(candidate, { bundle });
    assert.equal(result.ready, false, id);
    assert.equal(result.status, 'invalid', id);
    assert.equal(result.errors.some((error) => error.id === id), true, id);
  });
});

test('verify recognizes an exact tuple already present in the firmware catalog', function() {
  const input = doctorReport();
  input.error.details.router.model = 'GL.iNet GL-MT3000';
  input.error.details.router.firmware_version = '4.8.1 release8';
  input.error.details.router.firmware_type = 'release8';
  input.error.details.compatibility = {
    compatible: true,
    status: 'live-supported',
    runtimeContract: 'sdk4-modern-v1',
    firmware: '4.8.1',
    model: 'GL.iNet GL-MT3000',
    bundleSha256: '0409574b320a74de904a690df723134fc07471cddf5d622691ebbaa403116705',
    portableComponents: PORTABLE_COMPONENTS,
    staticPortableComponents: PORTABLE_COMPONENTS,
    componentEvidence: 'runtime-vue-options-components',
    source: 'http-admin-bundle',
  };

  const result = verifyCandidate(captureCandidate(input), {
    bundle: Buffer.from('catalog fixture'),
    analyzeAdminBundle() {
      return {
        bundleSha256: '0409574b320a74de904a690df723134fc07471cddf5d622691ebbaa403116705',
        contracts: { viewLoader: true, rpcRequest: true },
        staticPortableComponents: PORTABLE_COMPONENTS,
      };
    },
  });
  assert.equal(result.ready, true);
  assert.equal(result.status, 'already-supported');
  assert.deepEqual(result.catalogMatch, {
    id: 'gl-mt3000-4.8.1-release',
    validation: 'live-supported',
  });
});

test('compatibility CLI captures and verifies files with JSON output', async function(t) {
  const cwd = makeTempDir('glplugin-compatibility-');
  t.after(() => removeTempDir(cwd));
  const doctorFile = path.join(cwd, 'doctor.json');
  const candidateFile = path.join(cwd, 'candidate.json');
  const bundle = bundleFixture();
  const report = doctorReport();
  report.error.details.compatibility.bundleSha256 = crypto
    .createHash('sha256').update(bundle).digest('hex');
  const bundleFile = path.join(cwd, 'app.js');
  fs.writeFileSync(bundleFile, bundle);
  fs.writeFileSync(doctorFile, JSON.stringify(report, null, 2) + '\n');

  const captureOut = memoryStream();
  assert.equal(await cli.run([
    '--cwd', cwd,
    'compatibility', 'capture', 'doctor.json', '--output', 'candidate.json', '--json',
  ], { stdout: captureOut, stderr: memoryStream() }), 0);
  const captured = JSON.parse(captureOut.value);
  assert.equal(captured.result.outFile, candidateFile);
  assert.equal(fs.existsSync(candidateFile), true);

  const verifyOut = memoryStream();
  assert.equal(await cli.run([
    '--cwd', cwd, 'compatibility', 'verify', 'candidate.json', '--bundle', 'app.js', '--json',
  ], { stdout: verifyOut, stderr: memoryStream() }), 0);
  assert.equal(JSON.parse(verifyOut.value).result.status, 'ready-for-review');

  const invalid = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
  invalid.runtime.contract = 'legacy';
  fs.writeFileSync(candidateFile, JSON.stringify(invalid, null, 2) + '\n');
  const invalidOut = memoryStream();
  assert.equal(await cli.run([
    '--cwd', cwd, 'compatibility', 'verify', 'candidate.json', '--bundle', 'app.js', '--json',
  ], { stdout: invalidOut, stderr: memoryStream() }), 3);
  const failure = JSON.parse(invalidOut.value);
  assert.equal(failure.error.details.errors[0].id, 'runtime-contract');

  const help = memoryStream();
  assert.equal(await cli.run([
    'compatibility', 'verify', '--help',
  ], { cwd, stdout: help, stderr: memoryStream() }), 0);
  assert.match(help.value, /--bundle <app\.js\[\.gz\]>/);
});
