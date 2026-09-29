'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(command, args, options) {
  const result = spawnSync(command, args, Object.assign({ encoding: 'utf8' }, options));
  if (result.status !== 0 || result.error) {
    throw result.error || new Error(
      `${command} failed: ${String(result.stderr || result.stdout).trim()}`
    );
  }
  return result;
}

function extractTarGz(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  run('tar', ['-xzf', archive, '-C', destination]);
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createAuthStubPath(root) {
  const bin = path.join(root, 'auth-bin');
  fs.mkdirSync(bin, { recursive: true });
  const ubus = path.join(bin, 'ubus');
  const jsonfilter = path.join(bin, 'jsonfilter');
  fs.writeFileSync(ubus, [
    '#!/bin/sh',
    '[ "${GL_AUTH_SESSION_STATUS:-valid}" = valid ] || exit 4',
    'printf \'{"aclgroup":"%s"}\\n\' "${GL_AUTH_ACLGROUP:-root}"',
    '',
  ].join('\n'));
  fs.writeFileSync(jsonfilter, [
    '#!/bin/sh',
    'printf \'%s\\n\' "${GL_AUTH_ACLGROUP:-root}"',
    '',
  ].join('\n'));
  fs.chmodSync(ubus, 0o755);
  fs.chmodSync(jsonfilter, 0o755);
  return `${bin}:/usr/bin:/bin`;
}

function parseCgiResponse(output) {
  const sections = String(output).split(/\r?\n\r?\n/);
  return {
    headers: sections[0],
    body: JSON.parse(sections.slice(1).join('\n\n')),
  };
}

function localizeCgi(cgi, authHelper, destination) {
  const original = fs.readFileSync(cgi, 'utf8');
  const quotedHelper = `'${authHelper.replace(/'/g, `'"'"'`)}'`;
  const localized = original.replace(
    /^\. \/usr\/libexec\/[^\n]+\/admin-session\.sh$/m,
    `. ${quotedHelper}`
  );
  if (localized === original) throw new Error(`CGI auth helper import not found: ${cgi}`);
  fs.writeFileSync(destination, localized);
  fs.chmodSync(destination, 0o755);
  return destination;
}

function compatiblePlatform(overrides) {
  return {
    source: 'test-fixture',
    model: 'GL-MT3000',
    firmwareVersion: '4.8.1',
    analysis: {
      bundleSha256: '0409574b320a74de904a690df723134fc07471cddf5d622691ebbaa403116705',
      contracts: { viewLoader: true, rpcRequest: true },
      portableComponents: ['gl-button', 'gl-card', 'gl-line-chart', 'gl-tips', 'gl-title'],
    },
    compatibility: {
      compatible: true,
      status: 'live-supported',
      reason: 'test fixture',
    },
    fileChecks: {
      opkg: true,
      views: true,
      menus: true,
      functions: true,
      postinst: true,
      postinst_pkg: true,
      prerm: true,
      prerm_pkg: true,
    },
    architectures: [{ name: 'aarch64_cortex-a53', priority: 10 }],
    corePackage: { Package: 'gl-sdk4-ui-core' },
    freeKilobytes: 32768,
    errors: [],
    ...(overrides || {}),
  };
}

module.exports = {
  compatiblePlatform,
  createAuthStubPath,
  extractTarGz,
  localizeCgi,
  makeTempDir,
  parseCgiResponse,
  removeTempDir,
  run,
};
