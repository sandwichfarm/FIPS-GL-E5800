'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { makeTempDir, removeTempDir } = require('./helpers');

const root = path.resolve(__dirname, '..');

function sortedKeys(value) {
  return Object.keys(value).sort();
}

test('root module exposes the documented stable Node API', function() {
  const sdk = require('..');
  const pkg = require('../package.json');

  assert.equal(sdk.version, pkg.version);
  assert.deepEqual(sortedKeys(sdk), [
    'api', 'artifacts', 'errors', 'project', 'router', 'version',
  ]);
  assert.deepEqual(sortedKeys(sdk.api), ['createApiClient', 'createClient']);
  assert.deepEqual(sortedKeys(sdk.artifacts), ['build', 'inspect', 'package']);
  assert.deepEqual(sortedKeys(sdk.errors), ['CliError', 'EXIT_CODES']);
  assert.deepEqual(sortedKeys(sdk.project), ['check', 'init', 'read']);
  assert.deepEqual(sortedKeys(sdk.router), ['inspect', 'listCapabilities']);
  assert.equal(Object.isFrozen(sdk), true);
  assert.equal(Object.isFrozen(sdk.project), true);

  assert.equal(sdk.api.createClient, require('../lib/api-client').createClient);
  assert.equal(sdk.project.check, require('../lib/check').checkProject);
  assert.equal(sdk.project.init, require('../lib/init'));
  assert.equal(sdk.artifacts.build, require('../lib/build'));
  assert.equal(sdk.artifacts.inspect, require('../lib/inspect').inspectPackage);
  assert.equal(sdk.router.inspect, require('../lib/doctor').inspectRouter);
  assert.deepEqual(sdk.router.listCapabilities(), require('../lib/capabilities').listCapabilities());
});

test('package metadata publishes typed root and browser entrypoints', function() {
  const pkg = require('../package.json');
  assert.equal(pkg.main, 'index.js');
  assert.equal(pkg.types, 'index.d.ts');
  assert.equal(pkg.type, 'commonjs');
  assert.equal(pkg.exports['.'].import, './index.mjs');
  assert.deepEqual(sortedKeys(pkg.exports), [
    '.', './admin-session', './browser', './chart', './lib/*', './lib/*.js',
    './package.json', './runtime/*', './runtime/*.css', './runtime/*.js', './schema/*',
  ]);
  assert.equal(fs.existsSync(path.join(root, 'index.d.ts')), true);
  assert.equal(fs.existsSync(path.join(root, 'browser.d.ts')), true);
  assert.equal(fs.existsSync(path.join(root, 'rpc-api.d.ts')), true);
  assert.equal(fs.existsSync(path.join(root, 'lib', 'types.d.ts')), true);
  assert.match(fs.readFileSync(path.join(root, 'index.d.ts'), 'utf8'), /export interface PluginProject/);
  assert.match(fs.readFileSync(path.join(root, 'browser.d.ts'), 'utf8'), /glApiMixin/);
  const publicDocs = [
    fs.readFileSync(path.join(root, 'README.md'), 'utf8'),
    fs.readFileSync(path.join(root, 'docs', 'api.md'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(publicDocs, /gl-sdk4-plugin-kit\/lib\/(?:api|api-client)/);
});

test('packed npm artifact resolves root, browser, and legacy entrypoints', function(t) {
  const temporary = makeTempDir('glplugin-public-api-');
  t.after(() => removeTempDir(temporary));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = spawnSync(npm, [
    'pack', '--ignore-scripts', '--json', '--pack-destination', temporary,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: path.join(temporary, 'npm-cache') },
    shell: false,
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const archive = path.join(temporary, JSON.parse(packed.stdout)[0].filename);
  const unpacked = path.join(temporary, 'unpacked');
  const packageDir = path.join(temporary, 'node_modules', 'gl-sdk4-plugin-kit');
  fs.mkdirSync(unpacked, { recursive: true });
  fs.mkdirSync(path.dirname(packageDir), { recursive: true });
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', unpacked], {
    encoding: 'utf8', shell: false,
  });
  assert.equal(extracted.status, 0, extracted.stderr);
  fs.renameSync(path.join(unpacked, 'package'), packageDir);
  const consumer = path.join(temporary, 'consumer.js');
  fs.writeFileSync(consumer, "'use strict';\n");
  const packageRequire = createRequire(consumer);

  const sdk = packageRequire('gl-sdk4-plugin-kit');
  assert.equal(sdk.version, require('../package.json').version);
  assert.equal(typeof sdk.project.check, 'function');
  assert.equal(typeof packageRequire('gl-sdk4-plugin-kit/browser').createGlApi, 'function');
  assert.equal(typeof packageRequire('gl-sdk4-plugin-kit/chart').niceAxisMaximum, 'function');
  assert.equal(
    typeof packageRequire('gl-sdk4-plugin-kit/admin-session').createAdminSessionHeaders,
    'function'
  );
  assert.equal(
    typeof packageRequire('gl-sdk4-plugin-kit/lib/api-client').createClient,
    'function'
  );
  assert.equal(
    typeof packageRequire('gl-sdk4-plugin-kit/lib/api-client.js').createClient,
    'function'
  );

  const esmConsumer = path.join(temporary, 'consumer.mjs');
  fs.writeFileSync(esmConsumer, [
    "import sdk, { api, project, version } from 'gl-sdk4-plugin-kit';",
    "import { glApiMixin } from 'gl-sdk4-plugin-kit/browser';",
    "if (sdk.api !== api || sdk.project !== project) process.exit(2);",
    "if (typeof version !== 'string' || typeof glApiMixin !== 'object') process.exit(3);",
    '',
  ].join('\n'));
  const imported = spawnSync(process.execPath, [esmConsumer], {
    cwd: temporary,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);

  const typedConsumer = path.join(temporary, 'consumer.ts');
  fs.writeFileSync(typedConsumer, [
    "import { api } from 'gl-sdk4-plugin-kit';",
    'async function inspect(password: string): Promise<void> {',
    "  const client = await api.createClient('192.168.8.1', password);",
    '  const info = await client.system.getInfo();',
    '  const firmware: string = info.firmware_version;',
    '  const load = await client.system.getLoad();',
    '  const memory: unknown = load.memory_free;',
    '  void firmware;',
    '  void memory;',
    '}',
    'void inspect;',
    '',
  ].join('\n'));
  const typescriptPackageFile = require.resolve('typescript/package.json');
  const typescriptPackage = require(typescriptPackageFile);
  const tsc = path.resolve(path.dirname(typescriptPackageFile), typescriptPackage.bin.tsc);
  const typechecked = spawnSync(process.execPath, [
    tsc,
    '--noEmit',
    '--strict',
    '--module', 'Node16',
    '--moduleResolution', 'Node16',
    '--target', 'ES2020',
    typedConsumer,
  ], {
    cwd: temporary,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(typechecked.status, 0, typechecked.stderr || typechecked.stdout);
});
