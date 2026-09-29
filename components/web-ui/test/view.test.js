'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const cli = require('../lib/cli');
const { checkProject } = require('../lib/check');
const init = require('../lib/init');
const view = require('../lib/view');
const { makeTempDir, removeTempDir } = require('./helpers');

const repositoryRoot = path.resolve(__dirname, '..');

function memoryStream() {
  return {
    value: '',
    write(chunk) { this.value += String(chunk); },
  };
}

function projectFixture(t, name) {
  const cwd = makeTempDir('glplugin-view-');
  t.after(() => removeTempDir(cwd));
  const project = init(name || 'view-fixture', { cwd, log() {} });
  fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(project.dir, 'node_modules'));
  return project;
}

test('view add creates valid child and top-level entries without overwriting files', function(t) {
  const project = projectFixture(t);

  const child = view.addView(project.dir, { id: 'device-list', title: 'Devices' });
  assert.deepEqual(child.view, {
    id: 'view-fixture-device-list',
    entry: 'src/device-list.vue',
    menu: 'menus/device-list.json',
  });
  assert.deepEqual(child.menu, {
    index: 10,
    view: 'view-fixture-device-list',
    title: 'Devices',
    icon: 'setting',
    level: 2,
    parent: 'view-fixture',
    parent_icon: 'setting',
    parent_index: 80,
  });
  assert.match(
    fs.readFileSync(path.join(project.dir, child.view.entry), 'utf8'),
    /name: "DeviceListView"/
  );

  const topLevel = view.addView(project.dir, {
    id: 'reports',
    title: 'Reports',
    topLevel: true,
    icon: 'network',
    index: 95,
  });
  assert.deepEqual(topLevel.menu, {
    index: 95,
    view: 'view-fixture-reports',
    title: 'Reports',
    icon: 'network',
    level: 1,
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(project.dir, 'gl-plugin.json'), 'utf8'));
  assert.deepEqual(manifest.views.map((item) => item.id), [
    'view-fixture', 'view-fixture-device-list', 'view-fixture-reports',
  ]);
  assert.equal(checkProject(project.dir).ok, true);
  assert.throws(
    () => view.addView(project.dir, { id: 'device-list' }),
    /already exists/
  );

  const occupied = path.join(project.dir, 'src', 'occupied.vue');
  fs.writeFileSync(occupied, 'keep me\n');
  assert.throws(
    () => view.addView(project.dir, { id: 'occupied', entry: 'src/occupied.vue' }),
    /Refusing to overwrite/
  );
  assert.equal(fs.readFileSync(occupied, 'utf8'), 'keep me\n');
});

test('view add enforces a declared level 1 parent and project-contained paths', function(t) {
  const project = projectFixture(t, 'parent-fixture');
  view.addView(project.dir, { id: 'section', topLevel: true });
  view.addView(project.dir, { id: 'section-child', parent: 'section' });

  assert.throws(
    () => view.addView(project.dir, { id: 'third-level', parent: 'section-child' }),
    /must have a valid level 1 menu/
  );
  assert.throws(
    () => view.addView(project.dir, { id: 'orphan', parent: 'not-declared' }),
    /is not declared/
  );
  assert.throws(
    () => view.addView(project.dir, { id: 'escape', entry: '../escape.vue' }),
    /must stay inside the plugin project/
  );
  assert.throws(
    () => view.parseAddArgs(['conflict', '--parent', 'section', '--top-level']),
    /cannot be used together/
  );
  assert.throws(
    () => view.parseAddArgs(['invalid-index', '--index', '-1']),
    /--index requires a value/
  );
});

test('view remove preserves files by default and deletes only unreferenced files', function(t) {
  const project = projectFixture(t, 'remove-fixture');
  view.addView(project.dir, { id: 'section', topLevel: true });
  view.addView(project.dir, { id: 'section-child', parent: 'section' });

  assert.throws(
    () => view.removeView(project.dir, { id: 'section' }),
    /remove the child first/
  );
  assert.throws(
    () => view.removeView(project.dir, { id: 'remove-fixture' }),
    /primary view cannot be removed/
  );

  const child = view.removeView(project.dir, { id: 'section-child', deleteFiles: true });
  assert.deepEqual(child.deleted.sort(), [
    'menus/section-child.json', 'src/section-child.vue',
  ]);
  assert.equal(fs.existsSync(path.join(project.dir, 'src', 'section-child.vue')), false);

  const section = view.removeView(project.dir, { id: 'section' });
  assert.deepEqual(section.kept, ['src/section.vue', 'menus/section.json']);
  assert.equal(fs.existsSync(path.join(project.dir, 'src', 'section.vue')), true);
  assert.deepEqual(view.listViews(project.dir).map((item) => item.id), ['remove-fixture']);
});

test('view CLI supports add, list, remove, JSON output, and action help', async function(t) {
  const project = projectFixture(t, 'view-cli-fixture');
  const stderr = memoryStream();
  const addOut = memoryStream();

  assert.equal(await cli.run([
    '--cwd', project.dir, 'view', 'add', 'details', '--title', 'Details', '--json',
  ], { stdout: addOut, stderr }), 0);
  const added = JSON.parse(addOut.value);
  assert.equal(added.result.view.id, 'view-cli-fixture-details');

  const listOut = memoryStream();
  assert.equal(await cli.run(
    ['view', 'list', '--cwd', project.dir, '--json'],
    { stdout: listOut, stderr }
  ), 0);
  const listed = JSON.parse(listOut.value);
  assert.deepEqual(listed.result.views.map((item) => item.id), [
    'view-cli-fixture', 'view-cli-fixture-details',
  ]);
  assert.equal(listed.result.views[0].primary, true);
  assert.equal(listed.result.views[1].parent, 'view-cli-fixture');

  const helpOut = memoryStream();
  assert.equal(await cli.run(
    ['view', 'remove', '--help'],
    { cwd: project.dir, stdout: helpOut, stderr }
  ), 0);
  assert.match(helpOut.value, /view remove <id> \[--delete-files\]/);

  const removeOut = memoryStream();
  assert.equal(await cli.run(
    ['--cwd', project.dir, 'view', 'remove', 'details', '--delete-files', '--json'],
    { stdout: removeOut, stderr }
  ), 0);
  assert.equal(JSON.parse(removeOut.value).result.removed, 'view-cli-fixture-details');
  assert.equal(stderr.value, '');
});
