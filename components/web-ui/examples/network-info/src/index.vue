<template>
  <div>
    <gl-title title="Network Info" />

    <gl-card>
      <div class="section">
        <h3 class="section-heading">Device</h3>
        <gl-table :data="deviceRows">
          <gl-table-column prop="label" label="Property" />
          <gl-table-column prop="value" label="Value" />
        </gl-table>
      </div>
    </gl-card>

    <gl-card style="margin-top: 20px;">
      <div class="section">
        <h3 class="section-heading">System Status</h3>
        <gl-table :data="systemRows">
          <gl-table-column prop="label" label="Property" />
          <gl-table-column prop="value" label="Value" />
        </gl-table>
      </div>
    </gl-card>

    <gl-card v-if="networkRows.length" style="margin-top: 20px;">
      <div class="section">
        <h3 class="section-heading">Network Interfaces</h3>
        <gl-table :data="networkRows">
          <gl-table-column prop="iface" label="Interface" />
          <gl-table-column prop="status" label="Status" />
          <gl-table-column prop="online" label="Online" />
        </gl-table>
      </div>
    </gl-card>

    <gl-card v-if="wifiRows.length" style="margin-top: 20px;">
      <div class="section">
        <h3 class="section-heading">Wi-Fi</h3>
        <gl-table :data="wifiRows">
          <gl-table-column prop="ssid" label="SSID" />
          <gl-table-column prop="band" label="Band" />
          <gl-table-column prop="channel" label="Channel" />
          <gl-table-column prop="encryption" label="Security" />
          <gl-table-column prop="type" label="Type" />
        </gl-table>
      </div>
    </gl-card>

    <gl-card v-if="serviceRows.length" style="margin-top: 20px;">
      <div class="section">
        <h3 class="section-heading">Services</h3>
        <gl-table :data="serviceRows">
          <gl-table-column prop="name" label="Service" />
          <gl-table-column prop="status" label="Status" />
        </gl-table>
      </div>
    </gl-card>
  </div>
</template>

<script>
export default {
  name: 'NetworkInfo',
  data() {
    return {
      sysInfo: {},
      sysStatus: {},
    };
  },
  computed: {
    boardInfo() {
      return this.sysInfo.board_info || {};
    },
    sys() {
      return this.sysStatus.system || {};
    },
    deviceRows() {
      var b = this.boardInfo;
      var rows = [
        { label: 'Model', value: b.model || '--' },
        { label: 'Hostname', value: b.hostname || '--' },
        { label: 'Architecture', value: b.architecture || '--' },
        { label: 'Kernel', value: b.kernel_version || '--' },
        { label: 'OpenWrt', value: b.openwrt_version || '--' },
        { label: 'Firmware', value: this.sysInfo.firmware_version || '--' },
      ];
      if (this.sysInfo.mac) rows.push({ label: 'MAC', value: this.sysInfo.mac });
      if (this.sysInfo.cpu_num) rows.push({ label: 'CPU Cores', value: String(this.sysInfo.cpu_num) });
      return rows;
    },
    systemRows() {
      var s = this.sys;
      var rows = [
        { label: 'Uptime', value: this.formatUptime(s.uptime) },
        { label: 'LAN IP', value: s.lan_ip || '--' },
        { label: 'Mode', value: this.modeName(s.mode) },
      ];
      if (s.cpu && s.cpu.temperature) {
        rows.push({ label: 'CPU Temp', value: s.cpu.temperature + ' C' });
      }
      if (s.flash_total) {
        var freeMB = (s.flash_free / 1024 / 1024).toFixed(0);
        var totalMB = (s.flash_total / 1024 / 1024).toFixed(0);
        rows.push({ label: 'Flash Free', value: freeMB + ' / ' + totalMB + ' MB' });
      }
      if (s.guest_ip) {
        rows.push({ label: 'Guest IP', value: s.guest_ip });
      }
      return rows;
    },
    networkRows() {
      var net = this.sysStatus.network || [];
      return net.map(function (n) {
        return {
          iface: n.interface || '--',
          status: n.up ? 'Up' : 'Down',
          online: n.online ? 'Yes' : 'No',
        };
      });
    },
    wifiRows() {
      var wifi = this.sysStatus.wifi || [];
      return wifi.map(function (w) {
        return {
          ssid: w.ssid || '--',
          band: w.band || '--',
          channel: w.channel ? String(w.channel) : '--',
          encryption: w.encryption || '--',
          type: w.guest ? 'Guest' : 'Main',
        };
      });
    },
    serviceRows() {
      var svc = this.sysStatus.service || [];
      return svc.map(function (s) {
        return {
          name: s.name || '--',
          status: s.status ? 'Running' : 'Stopped',
        };
      });
    },
  },
  created() {
    this.fetchData();
  },
  methods: {
    rpc(module, func, params) {
      return this.$rpcRequest('call', ['sid', module, func, params || {}])
        .then(function (r) { return r; })
        .catch(function () { return null; });
    },
    async fetchData() {
      this.sysInfo = await this.rpc('system', 'get_info') || {};
      this.sysStatus = await this.rpc('system', 'get_status') || {};
    },
    formatUptime(s) {
      if (!s && s !== 0) return '--';
      var d = Math.floor(s / 86400);
      var h = Math.floor((s % 86400) / 3600);
      var m = Math.floor((s % 3600) / 60);
      var parts = [];
      if (d > 0) parts.push(d + 'd');
      if (h > 0) parts.push(h + 'h');
      parts.push(m + 'm');
      return parts.join(' ');
    },
    modeName(mode) {
      var modes = { 0: 'Router', 1: 'WDS', 2: 'Relay', 3: 'Mesh', 4: 'AP', 6: 'Passthrough' };
      return modes[mode] !== undefined ? modes[mode] : '--';
    },
  },
};
</script>

<style scoped>
.section {
  margin-bottom: 8px;
}
.section-heading {
  color: var(--title-color);
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
}
</style>
