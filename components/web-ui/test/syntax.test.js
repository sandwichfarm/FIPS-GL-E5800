'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { run } = require('./helpers');

const root = path.resolve(__dirname, '..');

function javascriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(function(entry) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return javascriptFiles(file);
    return entry.isFile() && (entry.name.endsWith('.js') || file === path.join(root, 'bin', 'glplugin'))
      ? [file]
      : [];
  });
}

function schemaPatterns(value, result) {
  if (!value || typeof value !== 'object') return result;
  if (typeof value.pattern === 'string') result.push(value.pattern);
  Object.values(value).forEach((child) => schemaPatterns(child, result));
  return result;
}

test('all shipped JavaScript parses and runtime type definitions load', function() {
  const shippedDirectories = [
    'bin',
    'lib',
    'scripts',
    'template',
    'examples/hello-world',
    'examples/network-info',
    'examples/full-stack',
  ];
  const files = shippedDirectories.flatMap(function(dir) {
    return javascriptFiles(path.join(root, dir));
  });
  files.forEach(function(file) {
    const result = run(process.execPath, ['--check', file]);
    assert.equal(result.stderr, '');
  });
  assert.deepEqual(require('../lib/types'), {});
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, 'lib', 'test.js'), 'utf8'),
    /process\.exit\(/
  );
  const schema = JSON.parse(
    fs.readFileSync(path.join(root, 'schema', 'gl-plugin.schema.json'), 'utf8')
  );
  schemaPatterns(schema, []).forEach((pattern) => assert.doesNotThrow(() => new RegExp(pattern)));
  run('sh', ['-n', path.join(root, 'template', 'profiles', 'full-stack', 'hooks', 'postinst')]);
  run('sh', ['-n', path.join(root, 'template', 'profiles', 'full-stack', 'hooks', 'prerm')]);
  run('sh', ['-n', path.join(
    root, 'template', 'profiles', 'full-stack', 'overlay', 'usr', 'libexec',
    '__PLUGIN_ID__', 'admin-session.sh'
  )]);
  run('sh', ['-n', path.join(
    root, 'examples', 'full-stack', 'overlay', 'usr', 'libexec', 'full-stack',
    'admin-session.sh'
  )]);
  run(path.join(root, 'node_modules', '.bin', 'tsc'), [
    '--noEmit',
    '--strict',
    '--module', 'Node16',
    '--moduleResolution', 'Node16',
    '--target', 'ES2020',
    path.join(root, 'test', 'fixtures', 'public-api.ts'),
    path.join(root, 'test', 'fixtures', 'public-api.mts'),
  ]);

  const compilerUtilsDir = path.dirname(
    require.resolve('@vue/component-compiler-utils/package.json')
  );
  const compilerPostcss = require(
    require.resolve('postcss/package.json', { paths: [compilerUtilsDir] })
  );
  assert.match(compilerPostcss.version, /^8\./);
});

test('CLI exposes its version and reports validation errors without a stack trace', function() {
  const cli = path.join(root, 'bin', 'glplugin');
  const pkg = require('../package.json');
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), pkg.version);
  const versionCommand = spawnSync(process.execPath, [cli, 'version'], { encoding: 'utf8' });
  assert.equal(versionCommand.status, 0);
  assert.equal(versionCommand.stdout.trim(), pkg.version);

  const invalid = spawnSync(process.execPath, [cli, 'init', '---'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /^Error: Plugin name must contain/m);
  assert.doesNotMatch(invalid.stderr, /\n\s+at /);
});
