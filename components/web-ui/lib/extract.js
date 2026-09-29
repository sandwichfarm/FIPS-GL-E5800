'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { call, login, logout } = require('./auth');
const { findComponentCatalog } = require('./component-catalog');
const { findFirmwaresByBundle } = require('./firmware-catalog');
const { CliError, EXIT_CODES } = require('./project');
const { readRouterPassword } = require('./prompt');
const { normalizeSshTarget, sshCapture, withSshSession } = require('./ssh-transport');

const APP_BUNDLE_COMMAND = 'set -- /www/js/app.*.js.gz; [ -f "$1" ] && cat "$1"';
const MENU_COMMAND = 'for f in /usr/share/oui/menu.d/*.json; do [ -f "$f" ] && cat "$f" && printf "\\000"; done';
const FIRMWARE_COMMAND = 'cat /etc/glversion';
const REDACTED_VALUE = '<redacted>';
const SENSITIVE_FIELD_PATTERN = /(?:^|[_-])(?:password|passwd|passphrase|secret|token|sid|nonce|salt|private[_-]?key|preshared[_-]?key|psk)(?:$|[_-])/i;
const SENSITIVE_FIELD_NAMES = new Set(['key', 'privatekey', 'presharedkey']);

const RPC_METHODS = [
  ['system', 'get_status'], ['system', 'get_info'],
  ['clients', 'get_status'],
  ['wifi', 'get_status'], ['wifi', 'get_config'],
  ['led', 'get_config'],
  ['fan', 'get_status'], ['fan', 'get_config'],
  ['dns', 'get_config'], ['dns', 'get_info'],
  ['ddns', 'get_status'], ['ddns', 'get_config'],
  ['tailscale', 'get_status'], ['tailscale', 'get_config'],
  ['adguardhome', 'get_config'],
  ['repeater', 'get_status'], ['repeater', 'get_config'],
  ['tor', 'get_status'], ['tor', 'get_config'],
  ['upgrade', 'get_config'],
  ['cloud', 'get_config'],
  ['wireguard', 'get_status'], ['wireguard', 'get_config'],
  ['openvpn', 'get_status'], ['openvpn', 'get_config'],
  ['network', 'get_status'], ['network', 'get_config'],
  ['nas', 'get_status'], ['nas', 'get_config'],
  ['firewall', 'get_status'], ['firewall', 'get_config'],
];

function parseExtractArgs(args, options) {
  const settings = options || {};
  const values = Array.isArray(args) ? args : [args].filter(Boolean);
  const parsed = {
    full: false,
    host: '',
    includeSensitive: false,
    insecureHostKey: false,
    passwordStdin: false,
    rpc: false,
    username: 'root',
    https: false,
    insecure: false,
  };
  const provided = new Set();

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--rpc') parsed.rpc = true;
    else if (value === '--full') parsed.full = true;
    else if (value === '--include-sensitive') parsed.includeSensitive = true;
    else if (value === '--password-stdin') parsed.passwordStdin = true;
    else if (value === '--insecure-host-key') {
      parsed.insecureHostKey = true;
      provided.add('hostKey');
    } else if (value === '--strict-host-key') {
      parsed.insecureHostKey = false;
      provided.add('hostKey');
    }
    else if (value === '--https') {
      parsed.https = true;
      provided.add('https');
    } else if (value === '--http') {
      parsed.https = false;
      provided.add('https');
    } else if (value === '--insecure') {
      parsed.insecure = true;
      provided.add('insecure');
    } else if (value === '--secure') {
      parsed.insecure = false;
      provided.add('insecure');
    } else if (value === '--username') {
      if (!values[index + 1] || values[index + 1].startsWith('-')) {
        throw new CliError('--username requires a value.');
      }
      parsed.username = values[index + 1];
      provided.add('username');
      index += 1;
    }
    else if (value.startsWith('-')) throw new CliError(`Unknown extract option: ${value}`);
    else if (!parsed.host) parsed.host = value;
    else throw new CliError('Usage: glplugin extract <host> [--rpc|--full]');
  }

  if (!parsed.host && !settings.allowMissingHost) {
    throw new CliError('Usage: glplugin extract <host> [--rpc|--full]');
  }
  parsed.rpcMode = parsed.rpc || parsed.full;
  parsed.sshMode = !parsed.rpc || parsed.full;
  if ((parsed.includeSensitive || parsed.passwordStdin) && !parsed.rpcMode) {
    throw new CliError('--include-sensitive and --password-stdin require --rpc or --full.');
  }
  if (parsed.insecureHostKey && !parsed.sshMode) {
    throw new CliError('--insecure-host-key requires SSH mode or --full.');
  }
  Object.defineProperty(parsed, 'provided', { enumerable: false, value: provided });
  return parsed;
}

function isSensitiveField(key) {
  const normalized = String(key).toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_FIELD_NAMES.has(normalized) || SENSITIVE_FIELD_PATTERN.test(key);
}

function sanitizeApiValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeApiValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [
    key,
    isSensitiveField(key) ? REDACTED_VALUE : sanitizeApiValue(nestedValue),
  ]));
}

function analyzeAdminBundle(content, options) {
  const settings = options || {};
  const cssVariables = new Set();
  const icons = new Set();
  const literalComponentRegistrations = new Set();
  const rpcMethods = new Set();
  let match;

  const bundleSha256 = crypto.createHash('sha256').update(content).digest('hex');
  const componentCatalog = findComponentCatalog(bundleSha256, settings.componentCatalogs);
  const firmwareCatalogEntries = findFirmwaresByBundle(bundleSha256);

  // These are diagnostics for reviewing an unknown bundle, not proof that the
  // corresponding installer was invoked against the app's Vue constructor.
  const componentRegex = /\.component\(\s*["']([A-Za-z][A-Za-z\d-]*)["']\s*,/g;
  while ((match = componentRegex.exec(content)) !== null) {
    literalComponentRegistrations.add(match[1]);
  }

  const cssVarRegex = /var\(--([a-z][-a-z0-9]*)/g;
  while ((match = cssVarRegex.exec(content)) !== null) cssVariables.add('--' + match[1]);

  const iconRegex = /icon:"([a-z][-a-z0-9]*)"/g;
  while ((match = iconRegex.exec(content)) !== null) icons.add(match[1]);

  const rpcRegex = /"call",\["sid","([^"]+)","([^"]+)"/g;
  while ((match = rpcRegex.exec(content)) !== null) {
    rpcMethods.add(`${match[1]}.${match[2]}`);
  }

  const uiComponents = componentCatalog ? componentCatalog.uiComponents : [];
  const routerComponents = componentCatalog ? componentCatalog.routerComponents : [];
  const componentRegistry = {
    status: componentCatalog ? 'verified' : 'unknown',
    source: componentCatalog ? componentCatalog.evidence : 'unverified-static-signals',
    catalogId: componentCatalog ? componentCatalog.id : null,
    model: componentCatalog ? componentCatalog.model : null,
    firmware: componentCatalog ? componentCatalog.firmware : null,
    channel: componentCatalog ? componentCatalog.channel : null,
    uiComponentCount: uiComponents.length,
    routerComponentCount: routerComponents.length,
    uiComponents,
    routerComponents,
    warning: componentCatalog
      ? null
      : 'Unknown bundle fingerprint; literal registrations are incomplete diagnostics, not a verified global registry.',
  };

  return {
    bundleSha256,
    bundleCatalog: {
      status: firmwareCatalogEntries.length ? 'known-bundle' : 'unknown-bundle',
      matches: firmwareCatalogEntries.map((entry) => ({
        catalogId: entry.id,
        model: entry.model,
        firmware: entry.firmware,
        validation: entry.validation,
      })),
      portableComponents: firmwareCatalogEntries.length
        ? firmwareCatalogEntries[0].portableComponents
        : [],
      warning: firmwareCatalogEntries.length
        ? 'Bundle match alone does not certify the target model and firmware tuple.'
        : 'Bundle fingerprint is not present in the firmware catalog.',
    },
    componentRegistry,
    // Kept for consumers of the original output shape. It now contains only
    // verified, canonical template tags and is empty for unknown bundles.
    components: uiComponents.map((entry) => entry.tag),
    literalComponentRegistrations: [...literalComponentRegistrations].sort(),
    cssVariables: [...cssVariables].sort(),
    icons: [...icons].sort(),
    rpcMethodsInCode: [...rpcMethods].sort(),
  };
}

function parseMenuDocuments(buffer) {
  return Buffer.from(buffer).toString('utf8').split('\0').filter((value) => value.trim())
    .flatMap((value) => {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    });
}

function extractViaSsh(host, options) {
  const settings = options || {};
  const target = normalizeSshTarget(host).target;
  return withSshSession(target, (transportOptions) => {
    let archive;
    try {
      archive = sshCapture(target, APP_BUNDLE_COMMAND, transportOptions);
    } catch (error) {
      throw new CliError(`Failed to download the admin bundle via SSH: ${error.message}`);
    }

    let content;
    try {
      content = zlib.gunzipSync(archive).toString('utf8');
    } catch (error) {
      throw new CliError(`Router admin bundle is not valid gzip data: ${error.message}`);
    }

    const result = {
      ...analyzeAdminBundle(content),
      firmware: '',
      menus: [],
      sshErrors: [],
    };

    try {
      result.menus = parseMenuDocuments(sshCapture(target, MENU_COMMAND, transportOptions));
    } catch (error) {
      result.sshErrors.push({ stage: 'menus', message: error.message });
    }

    try {
      result.firmware = Buffer.from(
        sshCapture(target, FIRMWARE_COMMAND, transportOptions)
      ).toString('utf8').trim();
    } catch (error) {
      result.sshErrors.push({ stage: 'firmware', message: error.message });
    }

    return result;
  }, {
    insecureHostKey: settings.insecureHostKey,
    spawnSync: settings.spawnSync,
  });
}

function rpcHostFromInput(host) {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(host)) return host;
  return host.includes('@') ? normalizeSshTarget(host).host : host;
}

module.exports = async function extract(input, options) {
  const settings = options || {};
  const parsed = parseExtractArgs(input, { allowMissingHost: Boolean(settings.resolveTarget) });
  const cwd = settings.cwd ? path.resolve(settings.cwd) : process.cwd();
  const log = settings.log || console.log;
  let target;
  if (settings.resolveTarget) {
    target = settings.resolveTarget(parsed.host);
  } else {
    const normalized = normalizeSshTarget(parsed.host);
    target = {
      ssh: normalized.target,
      rpcHost: normalized.host,
      username: normalized.user,
      https: false,
      insecure: false,
      insecureHostKey: false,
    };
  }
  const provided = parsed.provided || new Set();
  const username = provided.has('username') ? parsed.username : target.username;
  const transportOptions = {
    https: provided.has('https') ? parsed.https : target.https,
    insecure: provided.has('insecure') ? parsed.insecure : target.insecure,
  };
  const result = {
    extractedAt: (settings.now ? settings.now() : new Date()).toISOString(),
    firmware: '',
  };

  if (parsed.sshMode) {
    log('Extracting components via SSH...');
    const sshResult = extractViaSsh(target.ssh, {
      insecureHostKey: provided.has('hostKey') ? parsed.insecureHostKey : target.insecureHostKey,
      spawnSync: settings.spawnSync,
    });
    Object.assign(result, sshResult);

    if (result.componentRegistry.status === 'verified') {
      log(`  UI components:  ${result.componentRegistry.uiComponentCount} (verified)`);
      log(`  Router helpers: ${result.componentRegistry.routerComponentCount}`);
    } else {
      log('  UI components:  unknown (bundle fingerprint is not catalogued)');
      log(`  Static signals: ${result.literalComponentRegistrations.length} (diagnostic only)`);
    }
    log(`  Bundle catalog: ${result.bundleCatalog.status}`);
    log(`  Portable UI:    ${result.bundleCatalog.portableComponents.length}`);
    log(`  CSS Variables:  ${result.cssVariables.length}`);
    log(`  Icons:          ${result.icons.length}`);
    log(`  RPC in code:    ${result.rpcMethodsInCode.length}`);
    log(`  Menu entries:   ${result.menus.length}`);
    result.sshErrors.forEach((error) => log(`  [WARN] ${error.stage}: ${error.message}`));
  }

  if (parsed.rpcMode) {
    const rpcHost = target.rpcHost || rpcHostFromInput(parsed.host);
    log('\nTesting RPC endpoints...');
    const readPassword = settings.readRouterPassword || readRouterPassword;
    const authenticate = settings.login || login;
    const rpcCall = settings.call || call;
    const endSession = settings.logout || logout;
    const password = await readPassword({ passwordStdin: parsed.passwordStdin });
    let session;

    try {
      session = await authenticate(rpcHost, password, username, transportOptions);
      log('  Authenticated.');
    } catch (error) {
      throw new CliError(
        `RPC authentication failed: ${error.message}`, EXIT_CODES.CONNECTIVITY
      );
    }

    const working = [];
    const responses = {};
    try {
      for (const [module, method] of RPC_METHODS) {
        try {
          const response = await rpcCall(rpcHost, session.sid, module, method, {}, transportOptions);
          if (response !== undefined && response !== null) {
            const id = `${module}.${method}`;
            working.push(id);
            responses[id] = parsed.includeSensitive ? response : sanitizeApiValue(response);
            log(`  [OK]   ${id}`);
          }
        } catch (error) {
          // Unsupported methods are expected across models and firmware versions.
        }
      }
    } finally {
      try {
        await endSession(rpcHost, session.sid, transportOptions);
      } catch (error) {
        log('  [WARN] RPC session logout failed; the session will expire automatically.');
      }
    }

    result.confirmedMethods = working;
    result.apiResponses = responses;
    if (responses['system.get_info']) {
      result.firmware = responses['system.get_info'].firmware_version || result.firmware;
    }
    log(`\n  Confirmed working: ${working.length} methods`);
  }

  const outFile = path.join(cwd, 'extracted-components.json');
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
  log(`\n  Firmware: ${result.firmware}`);
  log(`  Saved to: ${outFile}\n`);
  return { outFile, result };
};

module.exports.APP_BUNDLE_COMMAND = APP_BUNDLE_COMMAND;
module.exports.FIRMWARE_COMMAND = FIRMWARE_COMMAND;
module.exports.MENU_COMMAND = MENU_COMMAND;
module.exports.RPC_METHODS = RPC_METHODS;
module.exports.REDACTED_VALUE = REDACTED_VALUE;
module.exports.analyzeAdminBundle = analyzeAdminBundle;
module.exports.extractViaSsh = extractViaSsh;
module.exports.parseExtractArgs = parseExtractArgs;
module.exports.parseMenuDocuments = parseMenuDocuments;
module.exports.rpcHostFromInput = rpcHostFromInput;
module.exports.sanitizeApiValue = sanitizeApiValue;
