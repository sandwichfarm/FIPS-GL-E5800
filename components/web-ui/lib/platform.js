'use strict';

const http = require('http');
const https = require('https');
const { normalizeRouterUrl } = require('./auth');
const { analyzeAdminBundle, evaluateCompatibility } = require('./compatibility');
const { CliError, EXIT_CODES } = require('./project');
const { sshCapture } = require('./ssh-transport');

const BOARD_COMMAND = 'ubus call system board';
const CORE_STATUS_COMMAND = 'opkg status gl-sdk4-ui-core';
const FIRMWARE_COMMAND = 'cat /etc/glversion';
const FREE_SPACE_COMMAND = 'df -Pk /overlay 2>/dev/null || df -Pk /';
const HOME_COMMAND = 'cat /www/gl_home.html';
const OPKG_ARCH_COMMAND = 'opkg print-architecture';
const PLATFORM_FILES_COMMAND = [
  'printf "opkg="; command -v opkg >/dev/null 2>&1 && echo 1 || echo 0',
  'printf "views="; [ -d /www/views ] && echo 1 || echo 0',
  'printf "menus="; [ -d /usr/share/oui/menu.d ] && echo 1 || echo 0',
  'printf "functions="; [ -f /lib/functions.sh ] && echo 1 || echo 0',
  'printf "postinst="; grep -q "default_postinst" /lib/functions.sh 2>/dev/null && echo 1 || echo 0',
  'printf "postinst_pkg="; grep -q "postinst-pkg" /lib/functions.sh 2>/dev/null && echo 1 || echo 0',
  'printf "prerm="; grep -q "default_prerm" /lib/functions.sh 2>/dev/null && echo 1 || echo 0',
  'printf "prerm_pkg="; grep -q "prerm-pkg" /lib/functions.sh 2>/dev/null && echo 1 || echo 0',
].join('; ');

function httpGet(host, urlPath, options) {
  return new Promise((resolve, reject) => {
    const settings = options || {};
    const rpcUrl = normalizeRouterUrl(host, settings);
    const target = new URL(urlPath, rpcUrl.origin);
    const transport = settings.transport || (target.protocol === 'https:' ? https : http);
    const request = transport.get(target, {
      timeout: settings.timeout || 10000,
      rejectUnauthorized: settings.insecure !== true,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('timeout')));
  });
}

function findAdminBundlePath(html) {
  const match = String(html || '').match(/(?:src|href)=["'](\/js\/app\.[A-Za-z0-9]+\.js)["']/);
  return match ? match[1] : '';
}

async function inspectPlatformViaHttp(host, options) {
  const settings = options || {};
  const request = settings.httpGet || httpGet;
  const home = await request(host, '/', settings);
  if (home.status !== 200) throw new Error(`admin page returned HTTP ${home.status}`);
  const appPath = findAdminBundlePath(home.body.toString('utf8'));
  if (!appPath) throw new Error('admin page does not reference an SDK4 app bundle');

  let app = await request(host, `${appPath}.gz`, settings);
  if (app.status !== 200) app = await request(host, appPath, settings);
  if (app.status !== 200) throw new Error(`admin bundle returned HTTP ${app.status}`);

  return {
    appPath,
    analysis: analyzeAdminBundle(app.body),
    source: 'http-admin-bundle',
  };
}

function parseKeyValueLines(value) {
  return Object.fromEntries(String(value || '').split(/\r?\n/).flatMap((line) => {
    const index = line.indexOf('=');
    return index > 0 ? [[line.slice(0, index), line.slice(index + 1) === '1']] : [];
  }));
}

function parseControl(value) {
  return Object.fromEntries(String(value || '').split(/\r?\n/).flatMap((line) => {
    const index = line.indexOf(':');
    return index > 0 ? [[line.slice(0, index), line.slice(index + 1).trim()]] : [];
  }));
}

function parseOpkgArchitectures(value) {
  return String(value || '').split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^arch\s+(\S+)\s+(\d+)$/);
    return match ? [{ name: match[1], priority: Number(match[2]) }] : [];
  });
}

function parseAvailableKilobytes(value) {
  const lines = String(value || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const columns = lines[lines.length - 1].trim().split(/\s+/);
  const available = Number(columns[3]);
  return Number.isFinite(available) ? available : null;
}

function captureText(target, command, settings, errors, id) {
  try {
    return Buffer.from((settings.sshCapture || sshCapture)(target, command, settings)).toString('utf8').trim();
  } catch (error) {
    errors.push({ id, message: error.message });
    return '';
  }
}

function inspectPlatformViaSsh(target, options) {
  const settings = options || {};
  const errors = [];
  const firmwareVersion = captureText(
    target, FIRMWARE_COMMAND, settings, errors, 'firmware'
  );
  const boardText = captureText(target, BOARD_COMMAND, settings, errors, 'board');
  let board = {};
  try {
    board = boardText ? JSON.parse(boardText) : {};
  } catch (error) {
    errors.push({ id: 'board', message: `invalid board JSON: ${error.message}` });
  }

  let analysis = { bundleSha256: '', contracts: {}, portableComponents: [] };
  try {
    const home = captureText(target, HOME_COMMAND, settings, errors, 'admin-home');
    const appPath = findAdminBundlePath(home);
    if (!appPath) {
      errors.push({ id: 'admin-home', message: 'active SDK4 app bundle is not referenced' });
    } else {
      const archive = (settings.sshCapture || sshCapture)(
        target, `cat /www${appPath}.gz`, settings
      );
      analysis = analyzeAdminBundle(archive);
    }
  } catch (error) {
    errors.push({ id: 'admin-bundle', message: error.message });
  }

  const fileChecks = parseKeyValueLines(captureText(
    target, PLATFORM_FILES_COMMAND, settings, errors, 'platform-files'
  ));
  const architectures = parseOpkgArchitectures(captureText(
    target, OPKG_ARCH_COMMAND, settings, errors, 'opkg-architectures'
  ));
  const corePackage = parseControl(captureText(
    target, CORE_STATUS_COMMAND, settings, errors, 'ui-core-package'
  ));
  const freeKilobytes = parseAvailableKilobytes(captureText(
    target, FREE_SPACE_COMMAND, settings, errors, 'free-space'
  ));
  const compatibility = evaluateCompatibility({
    analysis,
    bundleSha256: analysis.bundleSha256,
    firmwareVersion,
    model: board.model,
    minimumFirmware: settings.minimumFirmware,
    requiredComponents: settings.requiredComponents,
  });

  return {
    source: 'ssh-runtime',
    model: board.model || 'unknown',
    firmwareVersion,
    board,
    analysis,
    compatibility,
    fileChecks,
    architectures,
    corePackage,
    freeKilobytes,
    errors,
  };
}

function architectureSupported(packageArchitecture, architectures) {
  if (packageArchitecture === 'all') return true;
  return architectures.some((entry) => entry.name === packageArchitecture);
}

function assertPlatformCompatibility(report, manifest, options) {
  const settings = options || {};
  const failures = [];
  const compatibility = report.compatibility || {};
  const unverifiedAllowed = settings.allowUnverified && compatibility.status === 'unverified';
  if (!compatibility.compatible && !unverifiedAllowed) {
    failures.push(compatibility.reason || 'firmware compatibility is not verified');
  }
  const requiredFiles = [
    ['opkg', 'opkg is unavailable'],
    ['views', '/www/views is unavailable'],
    ['menus', '/usr/share/oui/menu.d is unavailable'],
    ['functions', '/lib/functions.sh is unavailable'],
    ['postinst', 'default_postinst is unavailable'],
    ['postinst_pkg', 'postinst-pkg dispatch is unavailable'],
    ['prerm', 'default_prerm is unavailable'],
    ['prerm_pkg', 'prerm-pkg dispatch is unavailable'],
  ];
  requiredFiles.forEach(([id, message]) => {
    if (report.fileChecks[id] !== true) failures.push(message);
  });
  if (report.corePackage.Package !== 'gl-sdk4-ui-core') {
    failures.push('gl-sdk4-ui-core is not installed');
  }
  if (!architectureSupported(manifest.package.architecture, report.architectures)) {
    failures.push(`package architecture ${manifest.package.architecture} is not accepted by opkg`);
  }

  const minimumFreeKilobytes = settings.minimumFreeKilobytes || 2048;
  if (report.freeKilobytes === null) {
    failures.push('free overlay space could not be determined');
  } else if (report.freeKilobytes < minimumFreeKilobytes) {
    failures.push(
      `only ${report.freeKilobytes} KiB is free; ${minimumFreeKilobytes} KiB is required`
    );
  }

  if (failures.length) {
    const error = new CliError(
      `Router platform preflight failed: ${failures.join('; ')}`,
      EXIT_CODES.VALIDATION
    );
    error.details = { failures, platform: report };
    throw error;
  }
  return {
    ...report,
    compatibility: {
      ...compatibility,
      override: unverifiedAllowed ? 'allow-unverified' : null,
    },
  };
}

module.exports = {
  BOARD_COMMAND,
  CORE_STATUS_COMMAND,
  FIRMWARE_COMMAND,
  FREE_SPACE_COMMAND,
  HOME_COMMAND,
  OPKG_ARCH_COMMAND,
  PLATFORM_FILES_COMMAND,
  architectureSupported,
  assertPlatformCompatibility,
  findAdminBundlePath,
  httpGet,
  inspectPlatformViaHttp,
  inspectPlatformViaSsh,
  parseAvailableKilobytes,
  parseControl,
  parseKeyValueLines,
  parseOpkgArchitectures,
};
