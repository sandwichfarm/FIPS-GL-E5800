'use strict';

const PORTABLE_COMPONENTS = Object.freeze([
  'gl-button',
  'gl-card',
  'gl-line-chart',
  'gl-tips',
  'gl-title',
]);

function entry(definition) {
  return Object.freeze({
    ...definition,
    componentEvidence: definition.componentEvidence || 'unverified-static-signals',
    portableComponents: Object.freeze([...(definition.portableComponents || [])]),
    staticPortableComponents: Object.freeze([
      ...(definition.staticPortableComponents || PORTABLE_COMPONENTS),
    ]),
    artifact: Object.freeze(definition.artifact),
  });
}

const FIRMWARE_CATALOG = Object.freeze([
  entry({
    id: 'gl-mt3000-4.8.1-release',
    model: 'GL-MT3000',
    firmware: '4.8.1',
    channel: 'release',
    validation: 'live-supported',
    lineChartContract: 'gl-line-chart-v1',
    componentEvidence: 'runtime-vue-options-components',
    portableComponents: PORTABLE_COMPONENTS,
    appBundleSha256: '0409574b320a74de904a690df723134fc07471cddf5d622691ebbaa403116705',
    appFile: 'www/js/app.73f13df2.js.gz',
    rootEntry: 'sysupgrade-glinet_gl-mt3000/root',
    openwrtRelease: '21.02-SNAPSHOT',
    openwrtArchitecture: 'aarch64_cortex-a53',
    packageArchitecture: 'aarch64_cortex-a53',
    artifact: {
      filename: 'mt3000-4.8.1-0819-1755615825.tar',
      url: 'https://fw.gl-inet.com/firmware/mt3000/release/mt3000-4.8.1-0819-1755615825.tar',
      sha256: 'ee038ee0f399c1454cc660dd47811b44697f5304e0f61af145c7dca6817d0e5c',
    },
  }),
  entry({
    id: 'gl-axt1800-4.8.3-release1',
    model: 'GL-AXT1800',
    firmware: '4.8.3',
    channel: 'release',
    validation: 'artifact-verified',
    appBundleSha256: '026bbda5adfc8b4128924b6c9151547cee20ac65d06a5a257b53f1d0e7c81301',
    appFile: 'www/js/app.9daa0476.js.gz',
    rootEntry: 'sysupgrade-glinet_axt1800/root',
    openwrtRelease: '23.05-SNAPSHOT',
    openwrtArchitecture: 'aarch64_cortex-a53_neon-vfpv4',
    packageArchitecture: 'aarch64_cortex-a53_neon-vfpv4',
    artifact: {
      filename: 'axt1800-4.8.3_release1-815-0413-1776065915.tar',
      url: 'https://fw.gl-inet.com/firmware/axt1800/release/axt1800-4.8.3_release1-815-0413-1776065915.tar',
      sha256: 'fdb284e1ac9886b7183b7a3bf1b2604603f757f41709d21949c0c4983e16ec5a',
    },
  }),
  entry({
    id: 'gl-sft1200-4.8.3-release4',
    model: 'GL-SFT1200',
    firmware: '4.8.3',
    channel: 'release',
    validation: 'artifact-verified',
    appBundleSha256: 'f18c79158c3bcae607560d3593e2504465285ec49127070ee27e12fd280b95af',
    appFile: 'www/js/app.3a5b974d.js.gz',
    rootEntry: 'sysupgrade-glinet_gl-sft1200/root',
    openwrtRelease: 'LEDE',
    openwrtDescription: '18.06',
    openwrtArchitecture: null,
    packageArchitecture: 'mips_siflower',
    artifact: {
      filename: 'sft1200-4.8.3_release4-1006-0609-1780999327.tar',
      url: 'https://fw.gl-inet.com/firmware/sft1200/release4/sft1200-4.8.3_release4-1006-0609-1780999327.tar',
      sha256: 'f84630b6b95f7558c0708672f739892b54acc3d78a4c92dae866faada9ff5e1f',
    },
  }),
  entry({
    id: 'gl-mt6000-4.9.1-release1',
    model: 'GL-MT6000',
    firmware: '4.9.1',
    channel: 'release',
    validation: 'artifact-verified',
    lineChartContract: 'gl-line-chart-v1',
    appBundleSha256: '7f932af072e305dbeca23bd33a941fa4cd1e556c46421bf9aebc5fb479162e3a',
    appFile: 'www/js/app.bfe03abe.js.gz',
    rootEntry: 'sysupgrade-glinet_gl-mt6000/root',
    openwrtRelease: '21.02-SNAPSHOT',
    openwrtArchitecture: 'aarch64_cortex-a53',
    packageArchitecture: 'aarch64_cortex-a53',
    artifact: {
      filename: 'mt6000-4.9.1_release1-1079-0804-1785826264.bin',
      url: 'https://fw.gl-inet.com/firmware/mt6000/release/mt6000-4.9.1_release1-1079-0804-1785826264.bin',
      sha256: '0342114922db0b5e98750a8414eeb23849ce1b8f30f85c46d6d11d69a070bcef',
    },
  }),
]);

function canonicalModel(value) {
  const match = String(value || '').toUpperCase().match(/\bGL-[A-Z0-9]+\b/);
  return match ? match[0] : String(value || '').trim().toUpperCase();
}

function normalizedFirmware(value) {
  const match = String(value || '').match(/(?:^|[^0-9])(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3] || 0)}` : '';
}

function findFirmwareByBundle(bundleSha256, criteria) {
  const filters = criteria || {};
  const model = filters.model ? canonicalModel(filters.model) : '';
  const firmware = filters.firmware ? normalizedFirmware(filters.firmware) : '';
  return findFirmwaresByBundle(bundleSha256, { model, firmware })[0] || null;
}

function findFirmwaresByBundle(bundleSha256, criteria) {
  const filters = criteria || {};
  const model = filters.model ? canonicalModel(filters.model) : '';
  const firmware = filters.firmware ? normalizedFirmware(filters.firmware) : '';
  return FIRMWARE_CATALOG.filter((item) => (
    item.appBundleSha256 === bundleSha256 &&
    (!model || canonicalModel(item.model) === model) &&
    (!firmware || normalizedFirmware(item.firmware) === firmware)
  ));
}

function findFirmwareById(id) {
  return FIRMWARE_CATALOG.find((item) => item.id === id) || null;
}

module.exports = {
  FIRMWARE_CATALOG,
  PORTABLE_COMPONENTS,
  canonicalModel,
  findFirmwareByBundle,
  findFirmwareById,
  findFirmwaresByBundle,
  normalizedFirmware,
};
