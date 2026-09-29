'use strict';

// One catalog drives the Vue mixin, Node client, documentation checks, and tests.
module.exports = {
  system: {
    module: 'system',
    methods: [
      'getStatus', 'getInfo', 'getLoad', 'getTimezoneConfig', 'getUsb3Disable',
      'setPassword', 'setTimezoneConfig', 'setUsb3Disable', 'reboot', 'resetFirmware'
    ]
  },
  vpnClient: {
    module: 'vpn-client',
    methods: [
      'getStatus', 'getAllConfigList', 'getTunnel', 'getConnectionMethods', 'getVpnUsingStatus',
      'addTunnel', 'setTunnel', 'removeTunnel', 'setDefaultTunnel', 'setGlobalMode',
      'setOptions', 'setTapS2s', 'setSingleMac', 'startRandomClient', 'stop',
      'orderTunnel', 'checkDomainOnline'
    ]
  },
  wgClient: {
    module: 'wg-client',
    methods: [
      'getGroupList', 'getConfigList', 'addConfig', 'setConfig', 'removeConfig',
      'addGroup', 'setGroup', 'removeGroup', 'clearConfigList', 'clearUserPass',
      'checkConfig', 'confirmConfig'
    ]
  },
  wgClientProvider: {
    module: 'wg_client',
    methods: ['genKey', 'getMaxClient', 'getProviderUserInfo', 'createProviderAccount', 'updateProviderConfig']
  },
  wgServer: {
    module: 'wg-server',
    methods: [
      'getConfig', 'getSetting', 'getPeerList', 'setConfig', 'setSetting',
      'addPeer', 'setPeer', 'removePeer', 'generateKey', 'generatePeer',
      'generatePublickey', 'start', 'stop'
    ]
  },
  ovpnClient: {
    module: 'ovpn-client',
    methods: [
      'getGroupList', 'getConfigList', 'getRecommendConfig', 'getThirdConfig',
      'addConfig', 'setConfig', 'removeConfig', 'addGroup', 'setGroup', 'removeGroup',
      'clearConfigList', 'clearUserPass', 'checkConfig', 'confirmConfig'
    ]
  },
  ovpnClientLegacy: { module: 'ovpn_client', methods: ['setConfigName'] },
  ovpnServer: {
    module: 'ovpn-server',
    methods: [
      'getConfig', 'getSetting', 'getUserList', 'setConfig', 'setSetting',
      'addUser', 'removeUser', 'exportConfig', 'generateCertificate'
    ]
  },
  wifi: {
    module: 'wifi',
    methods: ['getStatus', 'getConfig', 'setConfig', 'setTxpower', 'getMloConfig', 'setMloConfig']
  },
  clients: {
    module: 'clients',
    methods: ['getStatus', 'getList', 'setInfo', 'removeOffline', 'cleanTraffic']
  },
  firewall: {
    module: 'firewall',
    methods: [
      'getPortForwardList', 'getRuleList', 'getZoneList', 'getDmz', 'getWanAccess',
      'addPortForward', 'setPortForward', 'removePortForward', 'orderPortForward',
      'addRule', 'setRule', 'removeRule', 'setDmz', 'setWanAccess'
    ]
  },
  dns: { module: 'dns', methods: ['getConfig', 'getInfo', 'getHost', 'setConfig', 'setHost'] },
  lan: {
    module: 'lan',
    methods: [
      'getConfigList', 'getStaticBindList', 'getWanInfo',
      'setConfig', 'addStaticBind', 'setStaticBind', 'removeStaticBind'
    ]
  },
  network: {
    module: 'network',
    methods: [
      'getAdvanceConfig', 'getNetnatConfig', 'getArpList', 'getAvailableAddressList',
      'checkWanCable', 'setAdvanceConfig', 'setNetnatConfig'
    ]
  },
  cable: {
    module: 'cable',
    methods: [
      'getConfig', 'getPortsConfig', 'getPortsStatus', 'getStatus',
      'setConfig', 'setPortConfig', 'initStatus', 'wanProtoDetect'
    ]
  },
  repeater: {
    module: 'repeater',
    methods: [
      'getStatus', 'getConfig', 'getSavedApList', 'getChannelPrompt',
      'scan', 'connect', 'disconnect', 'setConfig', 'removeSavedAp',
      'setChannelPrompt', 'enterBareMode', 'exitBareMode'
    ]
  },
  tethering: { module: 'tethering', methods: ['getConfig', 'getStatus', 'setConnect', 'disconnect'] },
  netmode: { module: 'netmode', methods: ['getMode', 'setMode'] },
  tailscale: {
    module: 'tailscale',
    methods: ['getStatus', 'getConfig', 'getExitNodeList', 'getAuthUrl', 'setConfig', 'logout']
  },
  zerotier: { module: 'zerotier', methods: ['getStatus', 'getConfig', 'setConfig'] },
  tor: { module: 'tor', methods: ['getStatus', 'getConfig', 'setConfig'] },
  adguardhome: { module: 'adguardhome', methods: ['getConfig', 'setConfig'] },
  ddns: { module: 'ddns', methods: ['getStatus', 'getConfig', 'setConfig'] },
  cloud: { module: 'cloud', methods: ['getConfig', 'setConfig', 'unbind'] },
  led: { module: 'led', methods: ['getConfig', 'setConfig'] },
  fan: { module: 'fan', methods: ['getStatus', 'getConfig', 'setConfig'] },
  timer: {
    module: 'timer',
    methods: ['getLed', 'getReboot', 'getWifi', 'getScreen', 'setLed', 'setReboot', 'setWifi', 'setScreen']
  },
  plugins: {
    module: 'plugins',
    methods: [
      'getConfig', 'getList', 'getRepositoryStatus', 'getPackageInfo',
      'installPackage', 'removePackage', 'setConfig', 'updateRepository'
    ]
  },
  parentalControl: {
    module: 'parental-control',
    methods: [
      'getConfig', 'getStatus', 'getMode', 'getAppList', 'getBrief',
      'setConfig', 'setMode', 'setBrief', 'addGroup', 'setGroup', 'removeGroup',
      'addRule', 'setRule', 'removeRule', 'checkBlacklistOnline'
    ]
  },
  qos: { module: 'qos', methods: ['getConfig', 'setSpeedLimitRule', 'removeSpeedLimitRule'] },
  blackWhiteList: {
    module: 'black_white_list',
    methods: ['getConfig', 'setConfig', 'setSingleMac']
  },
  switchButton: {
    module: 'switch-button',
    methods: ['getConfig', 'getFuncs', 'setConfig', 'checkSyncStatus']
  },
  localAccess: { module: 'local-access', methods: ['getConfig', 'setConfig'] },
  luci: { module: 'luci', methods: ['getStatus', 'installLuci', 'uninstallLuci'] },
  logread: {
    module: 'logread',
    methods: [
      'getSystemLog', 'getKernelLog', 'getCrashLog', 'getNginxLog', 'getEsimLog',
      'getModuleName', 'getConfig', 'setConfig', 'exportLogs', 'removeCrashLog'
    ]
  },
  upgrade: {
    module: 'upgrade',
    methods: [
      'getConfig', 'setConfig', 'checkFirmwareOnline', 'checkFirmwareLocal',
      'checkCellularOnline', 'checkCellularLocal', 'getOnlineUpgradeStatus',
      'getCellularUpgradeStatus', 'resetCellularUpgradeStatus',
      'upgradeOnline', 'upgradeLocal'
    ]
  },
  ui: {
    module: 'ui',
    methods: ['getMenuList', 'getRemoteLangs', 'setLang', 'setInitedInternet', 'updateLangs']
  },
  ipv6: { module: 'ipv6', methods: ['getIpv6', 'setIpv6'] },
  igmp: { module: 'igmp', methods: ['getConfig', 'setConfig'] },
  kmwan: {
    module: 'kmwan',
    methods: ['getConfig', 'getStatus', 'getSensitivity', 'setConfig', 'setInterface', 'setSensitivity']
  },
  edgerouter: { module: 'edgerouter', methods: ['getConfig', 'getStatus', 'setConfig'] },
  rtty: { module: 'rtty', methods: ['getConfig', 'setConfig'] },
  smsForward: { module: 'sms-forward', methods: ['getConfig', 'setEmail', 'setPhoneNumber'] },
  modem: {
    module: 'modem',
    methods: [
      'getInfo', 'getStatus', 'getSimConfig', 'getSlotConfig', 'getCellsInfo',
      'getCellTower', 'getTrafficConfig', 'getOperatorConfig', 'getDebugMsg',
      'getProfileList', 'getApnPollEnabled', 'getSimcardInfo', 'getSmsList',
      'setSimConfig', 'setSlotConfig', 'setConnect', 'disconnect', 'setSimPinCode',
      'setCellTower', 'scanCellTower', 'scanOperatorList', 'setOperatorConfig',
      'setApnPollEnabled', 'setTrafficConfig', 'rebootModem', 'sendAtCommand',
      'sendSms', 'setSms', 'removeSms'
    ]
  },
  mptun: { module: 'mptun', methods: ['getConfig', 'getToken', 'setConfig'] },
  bark: { module: 'bark', methods: ['getConfig', 'getStatus', 'setConfig', 'logout'] },
  mvas: {
    module: 'mvas',
    methods: ['getConnectInfo', 'setConnectSlotNet', 'disconnectSlotNet', 'switchSimSlot']
  },
  sqm: {
    module: 'sqm',
    methods: ['getConfig', 'setConfig']
  },
  dpi: {
    module: 'dpi',
    methods: [
      'getQos', 'getApps', 'getContentProtection', 'getDpiStatus', 'getDpiConfig',
      'checkDpiUpgrade', 'checkLibUpgrade', 'getSubscribePopup', 'getDpiStats',
      'setQos', 'setContentProtection', 'modAppContentProtection', 'setDpiConfig',
      'setDpiUpgrade', 'setLibUpgrade', 'enableDpiBaseService',
      'setIgnoreSubuscribe', 'setDpiBaseServiceConfirm'
    ]
  }
};
