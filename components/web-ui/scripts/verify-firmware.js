#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { analyzeAdminBundle, decodeBundle } = require('../lib/compatibility');
const { findFirmwareById } = require('../lib/firmware-catalog');

function fail(message) {
  throw new Error(message);
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: options && options.encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readSquashfs(root, filename) {
  return Buffer.from(run('unsquashfs', ['-cat', root, filename]));
}

function listSquashfs(root, filename) {
  return String(run('unsquashfs', ['-ll', root, filename], { encoding: 'utf8' }));
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail(`Firmware download returned HTTP ${response.status}.`);
  const data = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, data);
}

function parseArgs(argv) {
  const parsed = { id: argv[2] || '', artifact: '', download: false };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === '--download') parsed.download = true;
    else if (argv[index] === '--artifact') {
      if (!argv[index + 1]) fail('--artifact requires a path.');
      parsed.artifact = path.resolve(argv[index + 1]);
      index += 1;
    } else fail(`Unknown option: ${argv[index]}`);
  }
  if (!parsed.id) {
    fail('Usage: node scripts/verify-firmware.js <catalog-id> [--artifact <file>|--download]');
  }
  return parsed;
}

function assertContains(value, expected, label) {
  if (!String(value).includes(expected)) fail(`${label} is missing ${expected}.`);
}

async function main() {
  const args = parseArgs(process.argv);
  const firmware = findFirmwareById(args.id);
  if (!firmware) fail(`Unknown firmware catalog id: ${args.id}`);
  const artifact = args.artifact || path.resolve(
    '.cache', 'firmware', firmware.artifact.filename
  );
  if (!fs.existsSync(artifact)) {
    if (!args.download) fail(`Firmware artifact not found: ${artifact}`);
    process.stdout.write(`Downloading ${firmware.artifact.url}\n`);
    await download(firmware.artifact.url, artifact);
  }

  const artifactData = fs.readFileSync(artifact);
  const artifactSha256 = sha256(artifactData);
  if (artifactSha256 !== firmware.artifact.sha256) {
    fail(`Firmware SHA-256 mismatch: expected ${firmware.artifact.sha256}, got ${artifactSha256}`);
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-firmware-contract-'));
  try {
    run('tar', ['-xf', artifact, '-C', temporary, firmware.rootEntry]);
    const root = path.join(temporary, firmware.rootEntry);
    const release = readSquashfs(root, 'etc/openwrt_release').toString('utf8');
    assertContains(release, `DISTRIB_RELEASE='${firmware.openwrtRelease}'`, 'OpenWrt release');
    if (firmware.openwrtDescription) {
      assertContains(release, firmware.openwrtDescription, 'OpenWrt description');
    }
    if (firmware.openwrtArchitecture) {
      assertContains(
        release,
        `DISTRIB_ARCH='${firmware.openwrtArchitecture}'`,
        'OpenWrt architecture'
      );
    }

    const appArchive = readSquashfs(root, firmware.appFile);
    const analysis = analyzeAdminBundle(appArchive);
    if (analysis.bundleSha256 !== firmware.appBundleSha256) {
      fail(
        `Admin bundle SHA-256 mismatch: expected ${firmware.appBundleSha256}, ` +
        `got ${analysis.bundleSha256}`
      );
    }
    if (!analysis.contracts.viewLoader || !analysis.contracts.rpcRequest) {
      fail('Admin bundle does not implement the sdk4-modern-v1 loader/RPC contract.');
    }
    if (
      firmware.lineChartContract &&
      analysis.lineChartContract.contractId !== firmware.lineChartContract
    ) {
      fail(
        `gl-line-chart contract changed: expected ${firmware.lineChartContract}, ` +
        `got ${analysis.lineChartContract.status} ` +
        `(${analysis.lineChartContract.missingEvidence.join(', ') || 'no contract'})`
      );
    }
    firmware.portableComponents.forEach((component) => {
      if (!analysis.portableComponents.includes(component)) {
        fail(`Admin bundle does not register portable component ${component}.`);
      }
    });
    firmware.staticPortableComponents.forEach((component) => {
      if (!analysis.staticPortableComponents.includes(component)) {
        fail(`Admin bundle does not contain static component signal ${component}.`);
      }
    });

    const login = decodeBundle(readSquashfs(
      root, 'www/views/gl-sdk4-ui-login.common.js.gz'
    )).toString('utf8');
    assertContains(login, '$getHash(', 'Login bundle');
    if (login.includes('$md5(')) fail('Login bundle uses the unsupported legacy MD5 outer hash.');

    const status = readSquashfs(root, 'usr/lib/opkg/status').toString('utf8');
    assertContains(status, 'Package: gl-sdk4-ui-core', 'opkg status');
    assertContains(status, `Architecture: ${firmware.packageArchitecture}`, 'opkg status');

    const functions = readSquashfs(root, 'lib/functions.sh').toString('utf8');
    ['default_postinst', 'postinst-pkg', 'default_prerm', 'prerm-pkg'].forEach((name) => {
      assertContains(functions, name, 'OpenWrt lifecycle dispatcher');
    });
    assertContains(listSquashfs(root, 'bin/opkg'), 'squashfs-root/bin/opkg', 'root filesystem');
    assertContains(
      listSquashfs(root, 'usr/share/oui/menu.d'),
      'squashfs-root/usr/share/oui/menu.d',
      'root filesystem'
    );
    const pluginMenu = JSON.parse(
      readSquashfs(root, 'usr/share/oui/menu.d/plugins.json').toString('utf8')
    );
    if (pluginMenu.view !== 'plugins' || pluginMenu.parent !== 'applications') {
      fail('Official plugin menu contract changed.');
    }

    process.stdout.write(JSON.stringify({
      ok: true,
      id: firmware.id,
      model: firmware.model,
      firmware: firmware.firmware,
      validation: firmware.validation,
      artifactSha256,
      appBundleSha256: analysis.bundleSha256,
      runtimeContract: 'sdk4-modern-v1',
      lineChartContract: analysis.lineChartContract.contractId,
      portableComponents: analysis.portableComponents,
      staticPortableComponents: analysis.staticPortableComponents,
      componentEvidence: analysis.componentEvidence,
    }, null, 2) + '\n');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Firmware contract failed: ${error.message}\n`);
  process.exitCode = 1;
});
