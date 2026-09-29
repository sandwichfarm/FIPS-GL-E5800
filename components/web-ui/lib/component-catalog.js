'use strict';

const GLINET_481 = [
  'gl-battery',
  'gl-button',
  'gl-card',
  'gl-cascader',
  'GlCheckbox',
  'GlCheckboxGroup',
  'GlCollapse',
  'GlCollapseGroup',
  'GlDraggableSort',
  'gl-drawer',
  'GlDropdown',
  'GlDropdownItem',
  'gl-ellipsis-tooltip',
  'gl-guide-icon',
  'gl-line-chart',
  'gl-link',
  'gl-percent-circle',
  'gl-private',
  'gl-pwd-strength',
  'gl-qrcode',
  'GlRadio',
  'GlRadioGroup',
  'GlScanWifi',
  'gl-search-input',
  'gl-switch',
  'gl-table',
  'gl-table-column',
  'gl-time-pick',
  'gl-tips',
  'gl-title',
  'GlToggle',
  'GlToggleItem',
  'gl-upload-card',
  'gl-week-select',
  'GlWifiList',
  'gl-wireless-signal',
];

const ELEMENT_481 = [
  'ElDialog',
  'ElForm',
  'el-form-item',
  'el-input',
  'ElMenu',
  'ElMenuItem',
  'ElMenuItemGroup',
  'ElOption',
  'ElPagination',
  'ElPopover',
  'el-select',
  'ElSlider',
  'ElSubmenu',
  'ElTabPane',
  'ElTabs',
  'ElTooltip',
];

const GLINET_490_ADDITIONS = [
  'gl-agree-check',
  'gl-number-input',
  'gl-otp-input',
  'gl-select-timezone',
  'gl-steps',
];

const ROUTER_COMPONENTS = ['RouterLink', 'RouterView'];

const REQUIRED_PARENTS = {
  GlCheckbox: 'gl-checkbox-group',
  GlCollapse: 'gl-collapse-group',
  GlDropdownItem: 'gl-dropdown',
  GlRadio: 'gl-radio-group',
  GlToggleItem: 'gl-toggle',
  'gl-table-column': 'gl-table',
  'el-form-item': 'el-form',
  ElMenuItem: 'el-menu',
  ElMenuItemGroup: 'el-menu',
  ElOption: 'el-select',
  ElSubmenu: 'el-menu',
  ElTabPane: 'el-tabs',
};

const ROUTER_CONTEXT = new Set(['gl-battery', 'GlScanWifi', 'GlWifiList']);

function canonicalTag(registryKey) {
  return registryKey
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function component(registryKey, origin) {
  const requiresParent = REQUIRED_PARENTS[registryKey] || null;
  return {
    registryKey,
    tag: canonicalTag(registryKey),
    origin,
    usage: requiresParent
      ? 'parent-dependent'
      : ROUTER_CONTEXT.has(registryKey) ? 'router-context' : 'standalone',
    requiresParent,
  };
}

function catalog(definition) {
  const uiComponents = [
    ...definition.glinet.map((name) => component(name, 'glinet')),
    ...ELEMENT_481.map((name) => component(name, 'element-ui')),
  ].sort((left, right) => left.tag.localeCompare(right.tag));
  const routerComponents = ROUTER_COMPONENTS
    .map((name) => component(name, 'vue-router'))
    .sort((left, right) => left.tag.localeCompare(right.tag));

  return Object.freeze({
    id: definition.id,
    model: 'GL-MT3000',
    firmware: definition.firmware,
    channel: definition.channel,
    bundleSha256: definition.bundleSha256,
    evidence: 'runtime-vue-options-components',
    uiComponents,
    routerComponents,
  });
}

const CATALOGS = Object.freeze([
  catalog({
    id: 'gl-mt3000-4.8.1-app.73f13df2',
    firmware: '4.8.1',
    channel: 'release',
    bundleSha256: '0409574b320a74de904a690df723134fc07471cddf5d622691ebbaa403116705',
    glinet: GLINET_481,
  }),
  catalog({
    id: 'gl-mt3000-4.9.0-beta6-app.2154ceec',
    firmware: '4.9.0 beta6',
    channel: 'testing',
    bundleSha256: 'd85b8cf6573572bbe4ba096a8c6f7043c7c2cd1df5541933c6b83192f05240c7',
    glinet: [...GLINET_481, ...GLINET_490_ADDITIONS],
  }),
]);

function findComponentCatalog(bundleSha256, catalogs) {
  return (catalogs || CATALOGS).find((entry) => entry.bundleSha256 === bundleSha256) || null;
}

module.exports = {
  CATALOGS,
  canonicalTag,
  findComponentCatalog,
};
