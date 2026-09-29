<template>
  <div>
    <gl-title title="Hello World" />
    <gl-card>
      <gl-tips state="info" tips="This is a sample GL.iNet plugin built with the gl-sdk4-plugin-kit." />

      <div class="info-section">
        <h3 class="section-heading">Device Information</h3>
        <div class="info-row">
          <span class="info-label">Model</span>
          <span class="info-value">{{ boardInfo.model || '--' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Hostname</span>
          <span class="info-value">{{ boardInfo.hostname || '--' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Kernel</span>
          <span class="info-value">{{ boardInfo.kernel_version || '--' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Firmware</span>
          <span class="info-value">{{ firmware }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Uptime</span>
          <span class="info-value">{{ formattedUptime }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Clients</span>
          <span class="info-value">{{ clients }}</span>
        </div>
      </div>

      <div v-if="error" class="error-text">{{ error }}</div>
    </gl-card>
  </div>
</template>

<script>
export default {
  name: 'HelloWorld',
  data() {
    return {
      sysInfo: {},
      sysStatus: {},
      clientStatus: {},
      error: '',
    };
  },
  computed: {
    boardInfo() {
      return this.sysInfo.board_info || {};
    },
    firmware() {
      return this.sysInfo.firmware_version || '--';
    },
    formattedUptime() {
      var sys = (this.sysStatus || {}).system || {};
      if (!sys.uptime) return '--';
      var s = sys.uptime;
      var d = Math.floor(s / 86400);
      var h = Math.floor((s % 86400) / 3600);
      var m = Math.floor((s % 3600) / 60);
      return d + 'd ' + h + 'h ' + m + 'm';
    },
    clients() {
      var c = this.clientStatus;
      if (!c.wireless_total && c.wireless_total !== 0) return '--';
      return c.wireless_total + ' wireless, ' + (c.cable_total || 0) + ' wired';
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
      this.clientStatus = await this.rpc('clients', 'get_status') || {};
    },
  },
};
</script>

<style scoped>
.info-section {
  margin-top: 20px;
}
.section-heading {
  color: var(--title-color);
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--table-border);
}
.info-label {
  color: var(--label-color);
  font-size: 14px;
}
.info-value {
  color: var(--text-color);
  font-size: 14px;
  font-weight: 500;
}
.error-text {
  text-align: center;
  padding: 20px;
  color: var(--error-color);
}
</style>
