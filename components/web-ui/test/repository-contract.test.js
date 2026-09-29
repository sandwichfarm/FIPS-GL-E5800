'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const build = require('../lib/build');
const { checkProject } = require('../lib/check');
const { inspectPackage } = require('../lib/inspect');
const packagePlugin = require('../lib/package');
const {
  createAuthStubPath,
  localizeCgi,
  makeTempDir,
  parseCgiResponse,
  removeTempDir,
} = require('./helpers');

const root = path.resolve(__dirname, '..');
const documentedExamples = ['hello-world', 'network-info', 'full-stack'];

test('documented examples are complete buildable plugin projects', function(t) {
  const temporary = makeTempDir('glplugin-examples-');
  t.after(() => removeTempDir(temporary));
  for (const name of documentedExamples) {
    const source = path.join(root, 'examples', name);
    for (const file of [
      '.babelrc', 'gl-plugin.json', 'menu.json', 'package.json', 'webpack.config.js',
    ]) {
      assert.equal(fs.existsSync(path.join(source, file)), true, `${name}/${file}`);
    }
    const destination = path.join(temporary, name);
    fs.cpSync(source, destination, { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(destination, 'node_modules'));
    assert.equal(checkProject(destination).ok, true);
    build({ cwd: destination, log() {} });
    const packaged = packagePlugin({ cwd: destination, log() {} });
    assert.equal(inspectPackage(packaged.ipkFile).ok, true);
  }
});

test('full-stack example packages a session-protected CGI backend', function(t) {
  const temporary = makeTempDir('glplugin-full-stack-example-');
  t.after(() => removeTempDir(temporary));
  const source = path.join(root, 'examples', 'full-stack');
  const destination = path.join(temporary, 'full-stack');
  fs.cpSync(source, destination, { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(destination, 'node_modules'));

  build({ cwd: destination, log() {} });
  const packaged = packagePlugin({ cwd: destination, log() {} });
  const inspection = inspectPackage(packaged.ipkFile);
  assert.equal(packaged.profile, 'full-stack');
  assert.deepEqual(inspection.conffiles, ['/etc/config/full-stack']);
  assert.equal(inspection.dataFiles.includes('www/cgi-bin/gl-sdk4-ui-full-stack'), true);
  assert.equal(
    inspection.dataFiles.includes('usr/libexec/full-stack/admin-session.sh'),
    true
  );
  assert.match(inspection.metadata.Depends, /(?:^|, )gl-oui-rpc(?:,|$)/);
  assert.match(inspection.metadata.Depends, /(?:^|, )ubus(?:,|$)/);
  assert.match(inspection.metadata.Depends, /(?:^|, )jsonfilter(?:,|$)/);
  assert.doesNotMatch(inspection.metadata.Depends, /(?:^|, )uhttpd(?:,|$)/);

  const installedCgi = path.join(
    destination, 'overlay', 'www', 'cgi-bin', 'gl-sdk4-ui-full-stack'
  );
  const authHelper = path.join(
    destination, 'overlay', 'usr', 'libexec', 'full-stack', 'admin-session.sh'
  );
  assert.ok(fs.statSync(installedCgi).mode & 0o100);
  const cgi = localizeCgi(
    installedCgi, authHelper, path.join(temporary, 'full-stack-cgi-under-test')
  );
  const missing = spawnSync('sh', [cgi], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '/usr/bin:/bin' },
  });
  assert.equal(missing.status, 0, missing.stderr);
  assert.match(parseCgiResponse(missing.stdout).headers, /Status: 401 Unauthorized/);

  const authPath = createAuthStubPath(temporary);
  const valid = spawnSync('sh', [cgi], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HTTP_X_GL_ADMIN_TOKEN: 'A'.repeat(32),
      PATH: authPath,
    },
  });
  assert.equal(valid.status, 0, valid.stderr);
  const validResponse = parseCgiResponse(valid.stdout);
  assert.match(validResponse.headers, /Content-Type: application\/json/);
  assert.equal(validResponse.body.status, 'ok');
  assert.equal(validResponse.body.backend, 'shell-cgi');
  assert.equal(typeof validResponse.body.enabled, 'boolean');
  assert.equal(Number.isInteger(validResponse.body.uptimeSeconds), true);

  const invalid = spawnSync('sh', [cgi], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GL_AUTH_SESSION_STATUS: 'invalid',
      HTTP_X_GL_ADMIN_TOKEN: 'B'.repeat(32),
      PATH: authPath,
    },
  });
  assert.match(parseCgiResponse(invalid.stdout).headers, /Status: 401 Unauthorized/);

  const forbidden = spawnSync('sh', [cgi], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GL_AUTH_ACLGROUP: 'viewer',
      HTTP_X_GL_ADMIN_TOKEN: 'C'.repeat(32),
      PATH: authPath,
    },
  });
  assert.match(parseCgiResponse(forbidden.stdout).headers, /Status: 403 Forbidden/);
});

test('repository documentation follows current security and API contracts', function() {
  const pkg = require('../package.json');
  const security = fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'docs', 'api.md'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(security, new RegExp(`\\| ${pkg.version.split('.').slice(0, 2).join('\\.')}\\.x \\| Yes \\|`));
  assert.doesNotMatch(api, /openssl passwd[^\n]*\$PASSWORD/);
  assert.doesNotMatch(api, /\['sid', 'system', '(?:board|info)'/);
  assert.match(api, /challenge\.alg/);
  assert.match(readme, /docs\/assets\/gl-mt3000-beryl-ax\.jpg/);
});
