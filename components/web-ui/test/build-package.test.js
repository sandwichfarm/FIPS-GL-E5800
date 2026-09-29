'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');
const build = require('../lib/build');
const { checkProject } = require('../lib/check');
const init = require('../lib/init');
const { inspectPackage } = require('../lib/inspect');
const { inspectBundleExport } = require('../lib/test');
const packagePlugin = require('../lib/package');
const { extractTarGz, makeTempDir, removeTempDir } = require('./helpers');

const repositoryRoot = path.resolve(__dirname, '..');

test('bundle wrapper returns CommonJS exports to the router eval loader', function() {
  const source = build.wrapBundleForEval('module.exports = { name: "fixture" };');
  const result = vm.runInNewContext(source);
  assert.equal(result.name, 'fixture');
});

test('generated plugin builds and packages with the official SDK4 layout', function(t) {
  const cwd = makeTempDir('glplugin-e2e-');
  t.after(function() { removeTempDir(cwd); });

  const project = init('package-fixture', { cwd });
  fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(project.dir, 'node_modules'));
  fs.writeFileSync(path.join(project.dir, 'i18n', 'README.txt'), 'not package data\n');
  fs.mkdirSync(path.join(project.dir, 'i18n', 'nested'));

  const buildResult = build({ cwd: project.dir });
  assert.ok(fs.existsSync(buildResult.gzFile));
  assert.match(
    fs.readFileSync(buildResult.jsFile, 'utf8'),
    /gl-sdk4-card--fill/
  );

  const packageResult = packagePlugin({ cwd: project.dir });
  assert.equal(packageResult.architecture, 'all');
  assert.equal(packageResult.profile, 'ui-only');
  assert.ok(fs.existsSync(packageResult.ipkFile));

  const inspection = inspectPackage(packageResult.ipkFile);
  assert.equal(inspection.ok, true);
  assert.equal(inspection.metadata.Package, 'gl-sdk4-ui-package-fixture');
  assert.equal(inspection.metadata.Architecture, 'all');
  assert.deepEqual(inspection.summary.viewFiles, [
    'www/views/gl-sdk4-ui-package-fixture.common.js.gz',
  ]);
  assert.deepEqual(inspection.summary.menuFiles, [
    'usr/share/oui/menu.d/package-fixture.json',
  ]);

  const outer = path.join(cwd, 'outer');
  const control = path.join(cwd, 'control');
  const data = path.join(cwd, 'data');
  extractTarGz(packageResult.ipkFile, outer);
  extractTarGz(path.join(outer, 'control.tar.gz'), control);
  extractTarGz(path.join(outer, 'data.tar.gz'), data);

  assert.equal(fs.readFileSync(path.join(outer, 'debian-binary'), 'utf8'), '2.0\n');
  assert.ok(fs.existsSync(path.join(data, 'www', 'views', 'gl-sdk4-ui-package-fixture.common.js.gz')));
  assert.ok(fs.existsSync(path.join(data, 'usr', 'share', 'oui', 'menu.d', 'package-fixture.json')));
  assert.ok(fs.existsSync(path.join(data, 'www', 'i18n', 'gl-sdk4-ui-package-fixture.en.json')));
  assert.ok(!fs.existsSync(path.join(data, 'www', 'i18n', 'README.txt')));
  assert.ok(!fs.existsSync(path.join(control, 'conffiles')));

  const metadata = fs.readFileSync(path.join(control, 'control'), 'utf8');
  assert.match(metadata, /^Package: gl-sdk4-ui-package-fixture$/m);
  assert.match(metadata, /^Depends: libc, gl-sdk4-ui-core$/m);
  assert.match(metadata, /^Architecture: all$/m);
  assert.match(metadata, /^X-GL-Firmware-Min: 4\.8\.0$/m);
  assert.match(metadata, /^X-GL-UI-Contract: sdk4-modern-v1$/m);
  assert.match(metadata, /^Installed-Size: [1-9][0-9]*$/m);
  assert.match(metadata, /^SourceName: gl-sdk4-ui-package-fixture$/m);
  assert.match(fs.readFileSync(path.join(control, 'postinst'), 'utf8'), /default_postinst/);
  assert.match(fs.readFileSync(path.join(control, 'prerm'), 'utf8'), /default_prerm/);

  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.package.architecture = 'aarch64_cortex-a53';
  manifest.package.depends.push('gl-sdk4-fixture-backend');
  manifest.compatibility.requiredCapabilities = ['wifi', 'repeater'];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  const configuredPackage = packagePlugin({ cwd: project.dir });
  assert.match(configuredPackage.ipkFile, /_aarch64_cortex-a53\.ipk$/);
  const configuredOuter = path.join(cwd, 'configured-outer');
  const configuredControl = path.join(cwd, 'configured-control');
  extractTarGz(configuredPackage.ipkFile, configuredOuter);
  extractTarGz(path.join(configuredOuter, 'control.tar.gz'), configuredControl);
  const configuredMetadata = fs.readFileSync(path.join(configuredControl, 'control'), 'utf8');
  assert.match(
    configuredMetadata,
    /^Depends: libc, gl-sdk4-ui-core, gl-sdk4-fixture-backend$/m
  );
  assert.match(configuredMetadata, /^Architecture: aarch64_cortex-a53$/m);
  assert.match(configuredMetadata, /^X-GL-RPC-Capabilities: wifi,repeater$/m);
});

test('generated plugin bundles the stable native chart adapter', function(t) {
  const cwd = makeTempDir('glplugin-chart-');
  t.after(function() { removeTempDir(cwd); });

  const project = init('chart-fixture', { cwd });
  fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(project.dir, 'node_modules'));
  fs.writeFileSync(path.join(project.dir, 'src', 'index.vue'), [
    '<template>',
    '  <gl-stable-line-chart',
    '    :labels="labels"',
    '    :value="values"',
    '    :minimum-y-max="100"',
    '    :height="210"',
    '  />',
    '</template>',
    '<script>',
    "const { GlStableLineChart } = require('@gl-sdk4-plugin-kit/chart');",
    'export default {',
    "  name: 'chart-fixture',",
    '  components: { GlStableLineChart },',
    '  data() { return { labels: [\'now\'], values: [42] }; },',
    '};',
    '</script>',
    '<style src="@gl-sdk4-plugin-kit/gl-line-chart.css"></style>',
    '',
  ].join('\n'));
  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.compatibility.requiredComponents.push('gl-line-chart');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  const buildResult = build({ cwd: project.dir });
  const bundle = fs.readFileSync(buildResult.jsFile, 'utf8');
  assert.match(bundle, /GlStableLineChart/);
  assert.match(bundle, /gl-sdk4-chart__bands/);
  assert.deepEqual(inspectBundleExport(fs.readFileSync(buildResult.gzFile)), {
    ok: true,
    detail: 'eval() returned a Vue component',
  });
});

test('multi-view plugin builds and packages every declared view and menu', function(t) {
  const cwd = makeTempDir('glplugin-multiview-');
  t.after(function() { removeTempDir(cwd); });

  const project = init('multi-view-fixture', { cwd });
  fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(project.dir, 'node_modules'));
  fs.copyFileSync(
    path.join(project.dir, 'src', 'index.vue'),
    path.join(project.dir, 'src', 'details.vue')
  );
  fs.mkdirSync(path.join(project.dir, 'menus'));
  fs.writeFileSync(path.join(project.dir, 'menus', 'details.json'), JSON.stringify({
    index: 20,
    view: 'multi-view-fixture-details',
    title: 'Details',
    icon: 'setting',
    level: 1,
  }, null, 2) + '\n');

  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.views = [
    { id: 'multi-view-fixture', entry: 'src/index.vue', menu: 'menu.json' },
    { id: 'multi-view-fixture-details', entry: 'src/details.vue', menu: 'menus/details.json' },
  ];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  const buildResult = build({ cwd: project.dir });
  assert.deepEqual(buildResult.views.map((view) => view.id), [
    'multi-view-fixture',
    'multi-view-fixture-details',
  ]);
  buildResult.views.forEach((view) => assert.ok(fs.existsSync(view.gzFile)));

  const checkResult = checkProject(project.dir);
  assert.equal(checkResult.ok, true);
  assert.equal(checkResult.checks.find((item) => item.id === 'menu.multi-view-fixture-details').status, 'pass');
  assert.equal(checkResult.checks.find((item) => item.id === 'source.multi-view-fixture-details').status, 'pass');
  assert.equal(checkResult.checks.find((item) => item.id === 'artifact.multi-view-fixture-details').status, 'pass');

  const packageResult = packagePlugin({ cwd: project.dir });
  const inspection = inspectPackage(packageResult.ipkFile);
  assert.deepEqual(inspection.summary.viewFiles.slice().sort(), [
    'www/views/gl-sdk4-ui-multi-view-fixture.common.js.gz',
    'www/views/gl-sdk4-ui-multi-view-fixture-details.common.js.gz',
  ].sort());
  assert.deepEqual(inspection.summary.menuFiles.slice().sort(), [
    'usr/share/oui/menu.d/multi-view-fixture.json',
    'usr/share/oui/menu.d/multi-view-fixture-details.json',
  ].sort());

  fs.writeFileSync(path.join(project.dir, 'i18n', 'gl-sdk4-ui-neighbor.en.json'), '{}\n');
  assert.throws(
    () => packagePlugin({ cwd: project.dir, log() {} }),
    /must start with "gl-sdk4-ui-multi-view-fixture\."/
  );
});

test('full-stack package preserves overlay, conffiles, and OpenWrt lifecycle dispatch', function(t) {
  const cwd = makeTempDir('glplugin-full-stack-');
  t.after(function() { removeTempDir(cwd); });

  const project = init('full-stack-fixture', { cwd, profile: 'full-stack' });
  fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(project.dir, 'node_modules'));
  build({ cwd: project.dir });

  const packageResult = packagePlugin({ cwd: project.dir });
  assert.equal(packageResult.profile, 'full-stack');
  const inspection = inspectPackage(packageResult.ipkFile);
  assert.equal(
    inspection.dataFiles.includes('usr/libexec/full-stack-fixture/admin-session.sh'),
    true
  );

  const outer = path.join(cwd, 'outer');
  const control = path.join(cwd, 'control');
  const data = path.join(cwd, 'data');
  extractTarGz(packageResult.ipkFile, outer);
  extractTarGz(path.join(outer, 'control.tar.gz'), control);
  extractTarGz(path.join(outer, 'data.tar.gz'), data);

  const backend = path.join(
    data, 'www', 'cgi-bin', 'gl-sdk4-ui-full-stack-fixture'
  );
  assert.ok(fs.existsSync(path.join(data, 'etc', 'config', 'full-stack-fixture')));
  assert.ok(fs.statSync(backend).mode & 0o100);
  assert.match(fs.readFileSync(backend, 'utf8'), /"backend":"shell-cgi"/);
  assert.match(
    fs.readFileSync(path.join(control, 'control'), 'utf8'),
    /Depends: libc, gl-sdk4-ui-core, gl-oui-rpc, ubus, jsonfilter, uci/
  );
  assert.equal(
    fs.readFileSync(path.join(control, 'conffiles'), 'utf8'),
    '/etc/config/full-stack-fixture\n'
  );
  assert.match(fs.readFileSync(path.join(control, 'postinst'), 'utf8'), /default_postinst/);
  assert.match(fs.readFileSync(path.join(control, 'prerm'), 'utf8'), /default_prerm/);
  assert.match(fs.readFileSync(path.join(control, 'postinst-pkg'), 'utf8'), /exit 0/);
  assert.match(fs.readFileSync(path.join(control, 'prerm-pkg'), 'utf8'), /exit 0/);
  assert.ok(fs.statSync(path.join(control, 'postinst-pkg')).mode & 0o100);
  assert.ok(fs.statSync(path.join(control, 'prerm-pkg')).mode & 0o100);

  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.package.conffiles.push('/etc/config/not-packaged');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  assert.throws(
    () => packagePlugin({ cwd: project.dir }),
    /Conffile is not present in package data: \/etc\/config\/not-packaged/
  );

  manifest.package.conffiles.pop();
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const collisionDir = path.join(project.dir, 'overlay', 'www', 'views');
  fs.mkdirSync(collisionDir, { recursive: true });
  const collisionFile = path.join(collisionDir, 'gl-sdk4-ui-full-stack-fixture.common.js.gz');
  fs.writeFileSync(collisionFile, 'overlay collision');
  assert.throws(
    () => packagePlugin({ cwd: project.dir }),
    /Overlay path collision: \/www\/views\/gl-sdk4-ui-full-stack-fixture/
  );
  fs.rmSync(collisionFile);

  const postinst = path.join(project.dir, 'hooks', 'postinst');
  const validPostinst = fs.readFileSync(postinst, 'utf8');
  fs.writeFileSync(postinst, '#!/bin/sh\nif broken; then\n');
  assert.throws(() => packagePlugin({ cwd: project.dir }), /sh exited with status/);
  fs.writeFileSync(postinst, validPostinst);
});
