'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const init = require('../lib/init');
const capabilityCatalog = require('../lib/doctor-capabilities');
const { CAPABILITY_IDS } = capabilityCatalog;
const { readPluginProject } = require('../lib/manifest');
const { makeTempDir, removeTempDir } = require('./helpers');

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

test('manifest is authoritative and rejects profile/path typos', function(t) {
  const cwd = makeTempDir('glplugin-manifest-');
  t.after(function() { removeTempDir(cwd); });
  const project = init('manifest-fixture', { cwd });
  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

  const normalized = readPluginProject(project.dir).manifest;
  assert.equal(normalized.compatibility.minimumFirmware, '4.8.0');
  assert.deepEqual(normalized.compatibility.requiredComponents, ['gl-card', 'gl-title']);
  assert.deepEqual(normalized.compatibility.requiredCapabilities, []);
  assert.deepEqual(normalized.views, [{
    id: 'manifest-fixture',
    entry: 'src/index.vue',
    menu: 'menu.json',
  }]);

  manifest.packge = {};
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /Unknown manifest field: packge/);

  delete manifest.packge;
  manifest.profile = 'full-stack';
  manifest.overlay = '../outside';
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /must stay inside the plugin project/);

  manifest.overlay = '.';
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /must stay inside the plugin project/);

  manifest.profile = 'ui-only';
  manifest.overlay = 'overlay';
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /only supported by the full-stack profile/);

  delete manifest.overlay;
  delete manifest.package.conffiles;
  manifest.package.architecture = 64;
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /"package\.architecture" must be a string/);

  manifest.package.architecture = 'all';
  manifest.compatibility.minimumFirmware = 'latest';
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /minimumFirmware/);

  manifest.compatibility.minimumFirmware = '4.8.0';
  manifest.compatibility.requiredComponents = ['gl-card', 'gl-card'];
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /must not contain duplicates/);

  manifest.compatibility.requiredComponents = ['gl-card', 'gl-title'];
  manifest.compatibility.requiredCapabilities = ['wifi', 'wifi'];
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /requiredCapabilities.*duplicates/);

  manifest.compatibility.requiredCapabilities = ['wifi', 'imaginary-radio'];
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /Unknown compatibility capability.*imaginary-radio/);

  manifest.compatibility.requiredCapabilities = ['wifi', 'repeater'];
  writeJson(manifestFile, manifest);
  assert.deepEqual(
    readPluginProject(project.dir).manifest.compatibility.requiredCapabilities,
    ['wifi', 'repeater']
  );
});

test('manifest validates explicit multi-view declarations', function(t) {
  const cwd = makeTempDir('glplugin-multiview-manifest-');
  t.after(function() { removeTempDir(cwd); });
  const project = init('multi-fixture', { cwd });
  const manifestFile = path.join(project.dir, 'gl-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.views = [
    { id: 'multi-fixture', entry: 'src/index.vue', menu: 'menu.json' },
    { id: 'multi-fixture-details', entry: 'src/details.vue', menu: 'menus/details.json' },
  ];
  writeJson(manifestFile, manifest);
  assert.deepEqual(
    readPluginProject(project.dir).manifest.views.map((view) => view.id),
    ['multi-fixture', 'multi-fixture-details']
  );

  manifest.views[1].id = 'another-plugin';
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /must be namespaced with "multi-fixture-"/);

  manifest.views[1].id = 'multi-fixture';
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /Duplicate view ID/);

  manifest.views[1].id = 'multi-fixture-details';
  manifest.views[1].menu = 'menu.json';
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /Duplicate view menu path/);

  manifest.views = [{
    id: 'multi-fixture-details', entry: 'src/details.vue', menu: 'menus/details.json',
  }];
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /must include the primary plugin ID/);

  manifest.views = [
    { id: 'multi-fixture', entry: 'src/index.vue', menu: 'menu.json' },
    { id: 'multi-fixture-details', entry: '../outside.vue', menu: 'menus/details.json' },
  ];
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /must stay inside the plugin project/);

  manifest.views = [];
  writeJson(manifestFile, manifest);
  assert.throws(() => readPluginProject(project.dir), /must be a non-empty array/);
});

test('manifest schema capability enum matches the runtime catalog', function() {
  const schema = require('../schema/gl-plugin.schema.json');
  assert.equal(Array.isArray(capabilityCatalog), true);
  assert.deepEqual(
    schema.properties.compatibility.properties.requiredCapabilities.items.enum,
    CAPABILITY_IDS
  );
});

test('legacy package.json projects remain readable without a manifest', function(t) {
  const cwd = makeTempDir('glplugin-legacy-');
  t.after(function() { removeTempDir(cwd); });
  writeJson(path.join(cwd, 'package.json'), {
    name: 'legacy-fixture',
    version: '1.0.0',
    pluginName: 'legacy-fixture',
    glPlugin: {
      architecture: 'mipsel_24kc',
      depends: ['libc', 'gl-sdk4-ui-core', 'legacy-backend'],
    },
  });

  const project = readPluginProject(cwd);
  assert.equal(project.legacy, true);
  assert.equal(project.manifest.id, 'legacy-fixture');
  assert.equal(project.manifest.profile, 'ui-only');
  assert.equal(project.manifest.package.architecture, 'mipsel_24kc');
  assert.equal(project.manifest.compatibility.minimumFirmware, '4.8.0');
  assert.deepEqual(project.manifest.compatibility.requiredCapabilities, []);
  assert.deepEqual(
    project.manifest.package.depends,
    ['libc', 'gl-sdk4-ui-core', 'legacy-backend']
  );
});

test('a package directory without manifest or legacy ID is not a plugin project', function(t) {
  const cwd = makeTempDir('glplugin-not-project-');
  t.after(function() { removeTempDir(cwd); });
  writeJson(path.join(cwd, 'package.json'), { name: 'ordinary-package' });
  assert.throws(() => readPluginProject(cwd), /No gl-plugin\.json found/);
});
