'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { analyzeLineChartContract } = require('./chart-contract');
const { findComponentCatalog } = require('./component-catalog');
const { findFirmwareByBundle, PORTABLE_COMPONENTS } = require('./firmware-catalog');

const MINIMUM_FIRMWARE = '4.8.0';
const RUNTIME_CONTRACT = 'sdk4-modern-v1';

function parseFirmwareVersion(value) {
  const match = String(value || '').match(/(?:^|[^0-9])(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
    normalized: parts.join('.'),
    parts,
  };
}

function compareFirmwareVersions(left, right) {
  const leftVersion = typeof left === 'string' ? parseFirmwareVersion(left) : left;
  const rightVersion = typeof right === 'string' ? parseFirmwareVersion(right) : right;
  if (!leftVersion || !rightVersion) {
    throw new TypeError('Both firmware versions must contain a numeric major.minor version.');
  }
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.parts[index] !== rightVersion.parts[index]) {
      return leftVersion.parts[index] < rightVersion.parts[index] ? -1 : 1;
    }
  }
  return 0;
}

function decodeBundle(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return zlib.gunzipSync(buffer);
  return buffer;
}

function analyzeAdminBundle(input, options) {
  const settings = options || {};
  const content = decodeBundle(input);
  const source = content.toString('utf8');
  const bundleSha256 = crypto.createHash('sha256').update(content).digest('hex');
  const staticPortableComponents = PORTABLE_COMPONENTS.filter((name) => (
    source.includes(`component("${name}"`) || source.includes(`component('${name}'`)
  ));
  const componentCatalog = findComponentCatalog(bundleSha256, settings.componentCatalogs);
  const lineChartContract = analyzeLineChartContract(source);
  const portableComponents = componentCatalog
    ? PORTABLE_COMPONENTS.filter((name) => (
      componentCatalog.uiComponents.some((component) => component.tag === name)
    ))
    : [];
  return {
    bundleSha256,
    contracts: {
      viewLoader: source.includes('/views/gl-sdk4-ui-') &&
        source.includes('.common.js') && source.includes('eval(res.data)'),
      rpcRequest: source.includes('prototype.$rpcRequest'),
    },
    componentCatalogId: componentCatalog ? componentCatalog.id : null,
    componentEvidence: componentCatalog
      ? componentCatalog.evidence
      : 'unverified-static-signals',
    lineChartContract,
    portableComponents,
    staticPortableComponents,
  };
}

function evaluateCompatibility(input) {
  const details = input || {};
  const minimumFirmware = details.minimumFirmware || MINIMUM_FIRMWARE;
  const firmware = parseFirmwareVersion(details.firmwareVersion);
  const minimum = parseFirmwareVersion(minimumFirmware);
  const requiredComponents = details.requiredComponents || [];
  const analysis = details.analysis || {};
  const contracts = analysis.contracts || {};
  const portableComponents = analysis.portableComponents || [];
  const staticPortableComponents = analysis.staticPortableComponents || [];
  const componentEvidence = analysis.componentEvidence || 'unknown';
  const bundleSha256 = details.bundleSha256 || analysis.bundleSha256 || '';

  if (!firmware || !minimum) {
    return {
      compatible: false,
      status: 'unsupported',
      runtimeContract: RUNTIME_CONTRACT,
      minimumFirmware,
      reason: 'firmware version could not be parsed',
    };
  }
  if (compareFirmwareVersions(firmware, minimum) < 0) {
    return {
      compatible: false,
      status: 'unsupported',
      runtimeContract: RUNTIME_CONTRACT,
      minimumFirmware,
      firmware: firmware.normalized,
      reason: `firmware ${firmware.normalized} is older than required ${minimum.normalized}`,
    };
  }

  const missingContracts = Object.entries({
    viewLoader: contracts.viewLoader,
    rpcRequest: contracts.rpcRequest,
  }).filter((entry) => entry[1] !== true).map((entry) => entry[0]);
  if (missingContracts.length) {
    return {
      compatible: false,
      status: 'unsupported',
      runtimeContract: RUNTIME_CONTRACT,
      minimumFirmware,
      firmware: firmware.normalized,
      bundleSha256,
      missingContracts,
      reason: `admin bundle is missing required contract(s): ${missingContracts.join(', ')}`,
    };
  }

  const missingComponents = requiredComponents.filter(
    (component) => !portableComponents.includes(component)
  );
  if (missingComponents.length) {
    const lacksRuntimeEvidence = componentEvidence !== 'runtime-vue-options-components';
    return {
      compatible: false,
      status: 'incompatible',
      runtimeContract: RUNTIME_CONTRACT,
      minimumFirmware,
      firmware: firmware.normalized,
      bundleSha256,
      missingComponents,
      componentEvidence,
      portableComponents,
      staticPortableComponents,
      reason: lacksRuntimeEvidence
        ? `runtime registry evidence is unavailable for required component(s): ${missingComponents.join(', ')}`
        : `admin bundle is missing required component(s): ${missingComponents.join(', ')}`,
    };
  }

  const catalogEntry = findFirmwareByBundle(bundleSha256, {
    model: details.model,
    firmware: firmware.normalized,
  });
  if (!catalogEntry) {
    const bundleEntry = findFirmwareByBundle(bundleSha256);
    return {
      compatible: false,
      status: 'unverified',
      runtimeContract: RUNTIME_CONTRACT,
      minimumFirmware,
      firmware: firmware.normalized,
      model: details.model || 'unknown',
      bundleSha256,
      portableComponents,
      staticPortableComponents,
      componentEvidence,
      reason: bundleEntry
        ? 'admin bundle is known but is not certified for this model and firmware tuple'
        : 'admin bundle contract is modern but its exact fingerprint is not verified',
    };
  }

  return {
    compatible: true,
    status: catalogEntry.validation,
    runtimeContract: RUNTIME_CONTRACT,
    minimumFirmware,
    firmware: firmware.normalized,
    model: details.model,
    bundleSha256,
    catalogId: catalogEntry.id,
    catalogModel: catalogEntry.model,
    catalogFirmware: catalogEntry.firmware,
    portableComponents,
    staticPortableComponents,
    componentEvidence,
    reason: catalogEntry.validation === 'live-supported'
      ? 'exact admin bundle is live validated'
      : 'exact admin bundle passed the official firmware artifact contract',
  };
}

module.exports = {
  MINIMUM_FIRMWARE,
  RUNTIME_CONTRACT,
  analyzeAdminBundle,
  compareFirmwareVersions,
  decodeBundle,
  evaluateCompatibility,
  parseFirmwareVersion,
};
