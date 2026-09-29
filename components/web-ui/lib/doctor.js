'use strict';

const fs = require('fs');
const path = require('path');
const { call, login, logout, normalizeRouterUrl } = require('./auth');
const { evaluateCompatibility, MINIMUM_FIRMWARE } = require('./compatibility');
const {
  CAPABILITIES: capabilities,
  evaluateCapabilityRequirements,
} = require('./doctor-capabilities');
const { readPluginProject } = require('./manifest');
const { inspectPlatformViaHttp } = require('./platform');
const { readRouterPassword } = require('./prompt');
const { applyRouterTarget, authOptions, parseRouterArgs } = require('./router-command');
const { CliError, EXIT_CODES } = require('./project');

function serializeError(error) {
  const result = { message: error && error.message ? error.message : String(error) };
  if (error && error.code !== undefined) result.code = error.code;
  if (error && error.data !== undefined) result.data = error.data;
  if (error && error.httpStatus !== undefined) result.http_status = error.httpStatus;
  return result;
}

function getGateState(definition, systemInfo) {
  if (!definition.gate) return { state: 'unknown' };
  const group = systemInfo[definition.gate.source];
  if (!group || !Object.prototype.hasOwnProperty.call(group, definition.gate.key)) {
    return { state: 'unknown' };
  }

  const value = group[definition.gate.key];
  return {
    state: value === false || value === '' || value === null ? 'unsupported' : 'supported',
    source: `system.get_info.${definition.gate.source}.${definition.gate.key}`,
  };
}

function isMissingMethod(error) {
  return error && (error.code === -32601 || error.code === -32001);
}

function sortedEnabledFeatures(group) {
  if (!group || typeof group !== 'object') return [];
  return Object.keys(group).filter((key) => Boolean(group[key])).sort();
}

function normalizeRouterInfo(info, status) {
  const board = info.board_info || {};
  const system = status.system || {};
  const firmwareVersion = info.firmware_version || 'unknown';
  const majorMatch = String(firmwareVersion).match(/^(\d+)/);

  return {
    model: board.model || info.model || 'unknown',
    hostname: board.hostname || 'unknown',
    vendor: info.vendor || 'unknown',
    firmware_version: firmwareVersion,
    firmware_type: info.firmware_type || 'unknown',
    hardware_version: info.hardware_version || 'unknown',
    architecture: board.architecture || 'unknown',
    kernel_version: board.kernel_version || 'unknown',
    openwrt_version: board.openwrt_version || 'unknown',
    network_mode: system.mode === undefined ? 'unknown' : system.mode,
    software_features: sortedEnabledFeatures(info.software_feature),
    hardware_features: sortedEnabledFeatures(info.hardware_feature),
    sdk_generation: majorMatch && majorMatch[1] === '4' ? 'SDK4 candidate' : 'unverified',
  };
}

function menuContainsView(value, view, seen) {
  if (!value || typeof value !== 'object') return false;
  const visited = seen || new Set();
  if (visited.has(value)) return false;
  visited.add(value);
  if (!Array.isArray(value) && value.view === view) return true;
  return Object.values(value).some((nested) => menuContainsView(nested, view, visited));
}

async function probeCapability(definition, context) {
  const gate = getGateState(definition, context.systemInfo);
  if (gate.state === 'unsupported') {
    return {
      id: definition.id,
      label: definition.label,
      rpc: `${definition.module}.${definition.rpcMethod}`,
      status: 'not-supported',
      reason: `disabled by ${gate.source}`,
    };
  }

  try {
    await context.rpcCall(
      context.host,
      context.sid,
      definition.module,
      definition.rpcMethod,
      {},
      context.transportOptions
    );
    return {
      id: definition.id,
      label: definition.label,
      rpc: `${definition.module}.${definition.rpcMethod}`,
      status: 'available',
      declared: gate.state === 'supported' ? 'supported' : 'unknown',
    };
  } catch (error) {
    return {
      id: definition.id,
      label: definition.label,
      rpc: `${definition.module}.${definition.rpcMethod}`,
      status: isMissingMethod(error) ? 'unavailable' : 'error',
      error: serializeError(error),
    };
  }
}

async function inspectRouter(host, password, options) {
  const settings = options || {};
  const transportOptions = {
    https: settings.https,
    insecure: settings.insecure,
    timeout: settings.timeout,
    transport: settings.transport,
    spawnSync: settings.spawnSync,
  };
  const authenticate = settings.login || login;
  const rpcCall = settings.call || call;
  const endSession = settings.logout || logout;
  const endpoint = normalizeRouterUrl(host, transportOptions);
  const startedAt = new Date().toISOString();
  const session = await authenticate(host, password, settings.username || 'root', transportOptions);
  const report = {
    ok: false,
    checked_at: startedAt,
    target: endpoint.origin,
    transport: {
      protocol: endpoint.protocol.slice(0, -1),
      tls_verification: endpoint.protocol === 'https:'
        ? (settings.insecure ? 'disabled-by-user' : 'enabled')
        : 'not-applicable',
    },
    auth: session.auth,
    router: null,
    compatibility: null,
    capability_contract: null,
    plugin: null,
    capabilities: [],
    errors: [],
  };

  try {
    const coreResults = await Promise.allSettled([
      rpcCall(host, session.sid, 'system', 'get_info', {}, transportOptions),
      rpcCall(host, session.sid, 'system', 'get_status', {}, transportOptions),
    ]);

    coreResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        report.errors.push({
          rpc: index === 0 ? 'system.get_info' : 'system.get_status',
          ...serializeError(result.reason),
        });
      }
    });

    if (coreResults[0].status !== 'fulfilled' || coreResults[1].status !== 'fulfilled') {
      return report;
    }

    const systemInfo = coreResults[0].value || {};
    const systemStatus = coreResults[1].value || {};
    report.router = normalizeRouterInfo(systemInfo, systemStatus);
    try {
      const inspectPlatform = settings.inspectPlatform || inspectPlatformViaHttp;
      const platform = await inspectPlatform(host, {
        ...transportOptions,
        httpGet: settings.httpGet,
      });
      report.compatibility = evaluateCompatibility({
        analysis: platform.analysis,
        firmwareVersion: report.router.firmware_version,
        model: report.router.model,
        minimumFirmware: settings.minimumFirmware || MINIMUM_FIRMWARE,
        requiredComponents: settings.requiredComponents || [],
      });
      report.compatibility.source = platform.source;
      report.compatibility.app_path = platform.appPath;
    } catch (error) {
      report.errors.push({ rpc: 'platform.admin_bundle', ...serializeError(error) });
      report.compatibility = {
        compatible: false,
        status: 'unsupported',
        minimumFirmware: settings.minimumFirmware || MINIMUM_FIRMWARE,
        reason: `admin bundle inspection failed: ${error.message}`,
      };
    }
    const compatibilityAccepted = report.compatibility.compatible || (
      settings.allowUnverified && report.compatibility.status === 'unverified'
    );
    report.compatibility.override = compatibilityAccepted && !report.compatibility.compatible
      ? 'allow-unverified'
      : null;
    report.router.sdk_generation = compatibilityAccepted ? 'SDK4 modern' : 'unverified';

    report.capabilities = await Promise.all(capabilities.map((definition) => probeCapability(definition, {
      host,
      sid: session.sid,
      systemInfo,
      rpcCall,
      transportOptions,
    })));
    report.capability_contract = evaluateCapabilityRequirements(
      report.capabilities,
      settings.requiredCapabilities || []
    );

    report.summary = report.capabilities.reduce((summary, capability) => {
      summary[capability.status] = (summary[capability.status] || 0) + 1;
      return summary;
    }, {});
    const requiredMenuViews = Array.isArray(settings.requiredMenuViews)
      ? settings.requiredMenuViews
      : [settings.requiredMenuView].filter(Boolean);
    if (requiredMenuViews.length) {
      try {
        const menuResult = await rpcCall(
          host, session.sid, 'ui', 'get_menu_list', {}, transportOptions
        );
        const menuViews = requiredMenuViews.map((view) => ({
          view,
          loaded: menuContainsView(menuResult, view),
        }));
        report.plugin = {
          menu_view: requiredMenuViews[0],
          menu_views: menuViews,
          menu_loaded: menuViews.every((view) => view.loaded),
        };
      } catch (error) {
        report.plugin = {
          menu_view: requiredMenuViews[0],
          menu_views: requiredMenuViews.map((view) => ({ view, loaded: false })),
          menu_loaded: false,
        };
        report.errors.push({ rpc: 'ui.get_menu_list', ...serializeError(error) });
      }
    }
    report.ok = compatibilityAccepted &&
      report.capability_contract.satisfied &&
      (!report.plugin || report.plugin.menu_loaded);
    return report;
  } finally {
    try {
      await endSession(host, session.sid, transportOptions);
    } catch (error) {
      report.ok = false;
      report.errors.push({ rpc: 'session.logout', ...serializeError(error) });
    }
  }
}

function value(valueToPrint) {
  if (Array.isArray(valueToPrint)) return valueToPrint.length ? valueToPrint.join(', ') : 'none reported';
  return valueToPrint === undefined || valueToPrint === null || valueToPrint === ''
    ? 'unknown'
    : String(valueToPrint);
}

function formatDoctorReport(report) {
  const lines = [
    '',
    'GL.iNet Plugin Doctor',
    `Target: ${report.target}`,
    `Auth: ${report.auth.name} (challenge.alg=${report.auth.alg})`,
    `TLS verification: ${report.transport.tls_verification}`,
  ];

  if (report.router) {
    lines.push(
      '',
      'Router',
      `  Model: ${value(report.router.model)}`,
      `  Hostname: ${value(report.router.hostname)}`,
      `  Firmware: ${value(report.router.firmware_version)} (${value(report.router.firmware_type)})`,
      `  SDK generation: ${value(report.router.sdk_generation)}`,
      `  OpenWrt: ${value(report.router.openwrt_version)}`,
      `  Kernel: ${value(report.router.kernel_version)}`,
      `  Architecture: ${value(report.router.architecture)}`,
      `  Network mode: ${value(report.router.network_mode)}`,
      `  Software features: ${value(report.router.software_features)}`,
      `  Hardware features: ${value(report.router.hardware_features)}`
    );
  }

  if (report.compatibility) {
    lines.push(
      '',
      'Compatibility',
      `  Status: ${value(report.compatibility.status)}`,
      `  Contract: ${value(report.compatibility.runtimeContract)}`,
      `  Bundle: ${value(report.compatibility.bundleSha256)}`,
      `  Reason: ${value(report.compatibility.reason)}`
    );
  }
  if (report.plugin) {
    const menuViews = Array.isArray(report.plugin.menu_views)
      ? report.plugin.menu_views
      : [{ view: report.plugin.menu_view, loaded: report.plugin.menu_loaded }];
    menuViews.forEach((menuView) => {
      lines.push(`  Menu view ${menuView.view}: ${menuView.loaded ? 'loaded' : 'missing'}`);
    });
  }

  if (report.capability_contract && report.capability_contract.required.length) {
    lines.push('', 'Required capabilities');
    report.capability_contract.checks.forEach((check) => {
      lines.push(
        `  [${check.satisfied ? 'PASS' : 'FAIL'}] ${check.id}: ${check.status}`
      );
    });
  }

  lines.push('', 'Capabilities');
  report.capabilities.forEach((capability) => {
    const marker = capability.status === 'available'
      ? 'PASS'
      : capability.status === 'error' ? 'WARN' : 'SKIP';
    const detail = capability.reason || (capability.error && capability.error.message) || capability.rpc;
    lines.push(`  [${marker}] ${capability.label}: ${capability.status} (${detail})`);
  });

  report.errors.forEach((error) => {
    lines.push(`  [FAIL] ${error.rpc}: ${error.message}`);
  });

  if (report.summary) {
    const counts = Object.keys(report.summary).sort().map((key) => `${key}=${report.summary[key]}`);
    lines.push('', `Summary: ${counts.join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function doctor(args, options) {
  const settings = options || {};
  const root = path.resolve(settings.cwd || process.cwd());
  const manifestFile = path.join(root, 'gl-plugin.json');
  const project = fs.existsSync(manifestFile) ? readPluginProject(root) : null;
  let parsed = parseRouterArgs(args || [], {
    allowJson: true,
    allowMissingHost: Boolean(settings.resolveTarget),
    allowUnverified: true,
    usage: 'Usage: glplugin doctor [target|host] [--https|--http] [--insecure|--secure] [--username <name>] [--password-stdin] [--allow-unverified]',
  });
  if (settings.resolveTarget) parsed = applyRouterTarget(parsed, settings.resolveTarget(parsed.host));
  const readPassword = settings.readRouterPassword || readRouterPassword;
  const password = await readPassword({ passwordStdin: parsed.passwordStdin });
  let report;
  try {
    const inspect = settings.inspectRouter || inspectRouter;
    report = await inspect(parsed.host, password, {
      ...authOptions(parsed),
      username: parsed.username,
      call: settings.call,
      login: settings.login,
      logout: settings.logout,
      spawnSync: settings.spawnSync,
      timeout: settings.timeout,
      transport: settings.transport,
      allowUnverified: parsed.allowUnverified,
      httpGet: settings.httpGet,
      inspectPlatform: settings.inspectPlatform,
      minimumFirmware: project && project.manifest.compatibility.minimumFirmware,
      requiredComponents: project && project.manifest.compatibility.requiredComponents,
      requiredCapabilities: project && project.manifest.compatibility.requiredCapabilities,
    });
  } catch (cause) {
    const error = new CliError(`Router doctor failed: ${cause.message}`, EXIT_CODES.CONNECTIVITY);
    error.cause = cause;
    throw error;
  }

  if (!(settings.json || parsed.json)) {
    const write = settings.output && settings.output.write
      ? settings.output.write
      : (value) => process.stdout.write(value);
    write(formatDoctorReport(report));
  }
  if (!report.ok) {
    const error = new CliError('Router doctor failed its compatibility checks.', EXIT_CODES.CONNECTIVITY);
    error.details = report;
    throw error;
  }
  return report;
}

module.exports = doctor;
module.exports.formatDoctorReport = formatDoctorReport;
module.exports.inspectRouter = inspectRouter;
module.exports.menuContainsView = menuContainsView;
