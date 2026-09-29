'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const init = require('../lib/init');
const toolkitPackage = require('../package.json');
const {
  createAuthStubPath,
  localizeCgi,
  makeTempDir,
  parseCgiResponse,
  removeTempDir,
} = require('./helpers');

function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(function(entry) {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(file) : [file];
  });
}

test('init creates a manifest-based ui-only project from one template', function(t) {
  const cwd = makeTempDir('glplugin-init-');
  t.after(function() { removeTempDir(cwd); });

  const result = init('  Foo--BAR plugin!  ', { cwd });
  assert.equal(result.slug, 'foo-bar-plugin');
  assert.equal(result.viewId, 'foo-bar-plugin');

  const pkg = JSON.parse(fs.readFileSync(path.join(result.dir, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(result.dir, 'gl-plugin.json'), 'utf8'));
  const menu = JSON.parse(fs.readFileSync(path.join(result.dir, 'menu.json'), 'utf8'));
  assert.equal(pkg.pluginName, undefined);
  assert.equal(pkg.glPlugin, undefined);
  assert.deepEqual(pkg.overrides, {
    '@vue/component-compiler-utils': { postcss: '^8.5.23' },
  });
  assert.equal(pkg.devDependencies['gl-sdk4-plugin-kit'], toolkitPackage.version);
  assert.equal(manifest.id, 'foo-bar-plugin');
  assert.equal(manifest.profile, 'ui-only');
  assert.deepEqual(manifest.package, {
    name: 'gl-sdk4-ui-foo-bar-plugin',
    architecture: 'all',
    depends: ['libc', 'gl-sdk4-ui-core'],
    section: 'base',
  });
  assert.equal(menu.view, 'foo-bar-plugin');
  assert.deepEqual(menu.title, { translate: 'foo-bar-plugin.title' });
  assert.ok(fs.existsSync(path.join(result.dir, '.gitignore')));
  assert.ok(fs.existsSync(
    path.join(result.dir, 'i18n', 'gl-sdk4-ui-foo-bar-plugin.en.json')
  ));
  assert.equal(fs.existsSync(path.join(result.dir, 'profiles')), false);
  assert.equal(fs.existsSync(path.join(result.dir, 'overlay')), false);

  const rendered = allFiles(result.dir).map(function(file) {
    return fs.readFileSync(file, 'utf8');
  }).join('\n');
  assert.doesNotMatch(rendered, /__[A-Z_]+__/);
});

test('init creates a full-stack overlay with executable backend and lifecycle hooks', function(t) {
  const cwd = makeTempDir('glplugin-init-full-');
  t.after(function() { removeTempDir(cwd); });

  const result = init('router-tools', { cwd, profile: 'full-stack' });
  const manifest = JSON.parse(fs.readFileSync(path.join(result.dir, 'gl-plugin.json'), 'utf8'));
  const backend = path.join(
    result.dir, 'overlay', 'www', 'cgi-bin', 'gl-sdk4-ui-router-tools'
  );
  const authHelper = path.join(
    result.dir, 'overlay', 'usr', 'libexec', 'router-tools', 'admin-session.sh'
  );
  const source = fs.readFileSync(path.join(result.dir, 'src', 'index.vue'), 'utf8');

  assert.equal(result.profile, 'full-stack');
  assert.equal(manifest.profile, 'full-stack');
  assert.equal(manifest.overlay, 'overlay');
  assert.deepEqual(manifest.package.depends, [
    'libc', 'gl-sdk4-ui-core', 'gl-oui-rpc', 'ubus', 'jsonfilter', 'uci',
  ]);
  assert.deepEqual(manifest.package.conffiles, ['/etc/config/router-tools']);
  assert.deepEqual(manifest.lifecycle, {
    postinst: 'hooks/postinst',
    prerm: 'hooks/prerm',
  });
  assert.ok(fs.statSync(backend).mode & 0o100);
  assert.ok(fs.statSync(authHelper).mode & 0o100);
  assert.ok(fs.statSync(path.join(result.dir, 'hooks', 'postinst')).mode & 0o100);
  assert.match(source, /fetch\('\/cgi-bin\/gl-sdk4-ui-router-tools'/);
  assert.match(source, /createAdminSessionHeaders/);

  const localBackend = localizeCgi(
    backend, authHelper, path.join(cwd, 'router-tools-cgi-under-test')
  );
  const backendResult = spawnSync('sh', [localBackend], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HTTP_X_GL_ADMIN_TOKEN: 'A'.repeat(32),
      PATH: createAuthStubPath(cwd),
    },
  });
  assert.equal(backendResult.status, 0, backendResult.stderr);
  const payload = parseCgiResponse(backendResult.stdout).body;
  assert.equal(payload.status, 'ok');
  assert.equal(payload.backend, 'shell-cgi');
  assert.equal(payload.enabled, true);
  assert.equal(Number.isInteger(payload.uptimeSeconds), true);
});

test('init rejects empty and conflicting names with controlled errors', function(t) {
  const cwd = makeTempDir('glplugin-init-errors-');
  t.after(function() { removeTempDir(cwd); });

  assert.throws(function() { init('---', { cwd }); }, /at least one letter or number/);
  init('existing', { cwd });
  assert.throws(function() { init('existing', { cwd }); }, /already exists/);

  const hyphenated = init('foo-bar', { cwd });
  const compact = init('foobar', { cwd });
  assert.notEqual(hyphenated.viewId, compact.viewId);
  assert.throws(
    function() { init('invalid-profile', { cwd, profile: 'backend-only' }); },
    /Unsupported plugin profile/
  );
  assert.deepEqual(
    init.parseInitArgs(['cli-fixture', '--profile', 'full-stack']),
    { install: false, name: 'cli-fixture', profile: 'full-stack' }
  );
  assert.deepEqual(
    init.parseInitArgs(['cli-fixture', '--install']),
    { install: true, name: 'cli-fixture', profile: 'ui-only' }
  );
  assert.throws(
    () => init.parseInitArgs(['cli-fixture', '--unknown']),
    /Unknown init option/
  );
});

test('init optionally installs pinned dependencies without a shell', function(t) {
  const cwd = makeTempDir('glplugin-init-install-');
  t.after(function() { removeTempDir(cwd); });
  const calls = [];

  const result = init('ready-project', {
    cwd,
    install: true,
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stderr: '' };
    },
  });

  assert.equal(result.installed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  assert.deepEqual(calls[0].args, ['install']);
  assert.equal(calls[0].options.cwd, result.dir);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('init keeps a generated project when dependency installation fails', function(t) {
  const cwd = makeTempDir('glplugin-init-install-failure-');
  t.after(function() { removeTempDir(cwd); });
  const projectDir = path.join(cwd, 'broken-project');

  assert.throws(
    () => init('broken-project', {
      cwd,
      install: true,
      json: true,
      spawnSync(command, args, options) {
        assert.deepEqual(options.stdio, ['inherit', 'pipe', 'pipe']);
        return { status: 17, stderr: 'registry unavailable\n' };
      },
    }),
    /npm install failed with status 17.*registry unavailable.*Project remains at/m
  );
  assert.equal(fs.existsSync(path.join(projectDir, 'package.json')), true);
});
