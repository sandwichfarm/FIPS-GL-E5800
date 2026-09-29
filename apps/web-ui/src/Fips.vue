<template>
  <section class="fips-panel" aria-label="FIPS mesh network">
    <header><h1>FIPS</h1><button :disabled="busy" @click="refresh">Refresh</button></header>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <section class="card">
      <h2>Node</h2>
      <dl>
        <dt>Status</dt><dd>{{ status.state || 'Loading' }}</dd>
        <dt>Public identity</dt><dd class="identity">{{ status.npub || 'Unavailable while stopped' }}</dd>
        <dt>IPv6 address</dt><dd>{{ status.ipv6_addr || '—' }}</dd>
        <dt>Peers</dt><dd>{{ status.peer_count == null ? '—' : status.peer_count }}</dd>
        <dt>Persistent identity</dt><dd>{{ status.persistent == null ? 'Unknown' : status.persistent ? 'Yes' : 'No' }}</dd>
      </dl>
    </section>
    <section class="card">
      <h2>Connected peers</h2>
      <p v-if="!peers.length">No connected peers.</p>
      <ul><li v-for="peer in peers" :key="peer.npub">
        <span class="identity">{{ peer.display_name || peer.npub }}</span>
        — {{ peer.connectivity }} · {{ peer.transport_type }}
      </li></ul>
    </section>
    <form v-if="settings" class="card" @submit.prevent="stage">
      <h2>Configuration</h2>
      <label><input v-model="settings.enabled" type="checkbox"> Enable node</label>
      <label><input v-model="settings.gateway_enabled" type="checkbox"> Enable LAN gateway</label>
      <p class="hint">LAN gateway needs working LAN IPv6. Changes are staged before activation.</p>
      <label>UDP port <input v-model.number="settings.udp_port" type="number" min="1024" max="65535" required></label>
      <label>TCP port <input v-model.number="settings.tcp_port" type="number" min="1024" max="65535" required></label>
      <h3>Configured peers</h3>
      <fieldset v-for="(peer, index) in settings.peers" :key="index">
        <legend>Peer {{ index + 1 }}</legend>
        <label>Public key <input v-model.trim="peer.npub" placeholder="npub1…" required></label>
        <label>Transport <select v-model="peer.transport"><option>udp</option><option>tcp</option></select></label>
        <label>Address <input v-model.trim="peer.address" placeholder="peer.example:2121" required></label>
        <button type="button" @click="settings.peers.splice(index, 1)">Remove peer</button>
      </fieldset>
      <button type="button" :disabled="settings.peers.length >= 64" @click="addPeer">Add peer</button>
      <h3>Mesh access to this router</h3>
      <p class="hint">Only listed service ports are permitted. Empty lists keep inbound services closed.</p>
      <label>TCP ports <input v-model="tcpPorts" placeholder="Comma-separated ports"></label>
      <label>UDP ports <input v-model="udpPorts" placeholder="Comma-separated ports"></label>
      <footer><button :disabled="busy" type="submit">Validate and stage</button></footer>
    </form>
    <section class="card"><h2>Diagnostics</h2>
      <button :disabled="busy" @click="diagnose">Check node health</button>
      <pre v-if="diagnostics">{{ diagnostics }}</pre>
    </section>
  </section>
</template>

<script>
const { createApi } = require('./api.cjs');

export default {
  name: 'FipsPanel',
  data() {
    return { status: {}, peers: [], settings: null, revision: '', tcpPorts: '', udpPorts: '',
      error: '', notice: '', diagnostics: '', busy: false };
  },
  created() { this.request = createApi(); this.refresh(); },
  methods: {
    async refresh() {
      this.busy = true; this.error = '';
      try {
        const [status, configuration] = await Promise.all([this.request('status'), this.request('configuration')]);
        this.status = status; this.settings = configuration.settings; this.revision = configuration.revision;
        this.tcpPorts = this.settings.mesh_tcp_ports.join(', '); this.udpPorts = this.settings.mesh_udp_ports.join(', ');
        this.peers = status.state === 'offline' ? [] : (await this.request('peers')).peers;
      } catch (error) { this.error = error.message; }
      finally { this.busy = false; }
    },
    addPeer() { this.settings.peers.push({ npub: '', transport: 'udp', address: '' }); },
    ports(value) {
      if (!value.trim()) return [];
      return value.split(',').map(item => {
        if (!/^\s*\d{1,5}\s*$/.test(item)) throw new Error('Enter comma-separated port numbers.');
        const port = Number(item);
        if (port < 1 || port > 65535) throw new Error('Ports must be between 1 and 65535.');
        return port;
      });
    },
    async stage() {
      this.busy = true; this.error = ''; this.notice = '';
      try {
        this.settings.mesh_tcp_ports = this.ports(this.tcpPorts);
        this.settings.mesh_udp_ports = this.ports(this.udpPorts);
        await this.request('stage', { settings: this.settings, expected_revision: this.revision });
        this.notice = 'Configuration validated and staged. Running services are unchanged.';
      } catch (error) { this.error = error.message; }
      finally { this.busy = false; }
    },
    async diagnose() {
      this.busy = true; this.error = '';
      try { this.diagnostics = JSON.stringify(await this.request('diagnostics'), null, 2); }
      catch (error) { this.error = error.message; }
      finally { this.busy = false; }
    },
  },
};
</script>

<style scoped>
.fips-panel { max-width: 900px; margin: auto; padding: 20px; font: 15px/1.5 system-ui, sans-serif; color: #192d3b; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h1 { font-size: 30px; } h2 { font-size: 20px; margin-top: 0; }
.card { background: #fff; border: 1px solid #ccd6df; border-radius: 8px; padding: 20px; margin: 16px 0; }
dl { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 8px; } dd { margin: 0; }
.identity { overflow-wrap: anywhere; font-family: monospace; } .error { color: #a11422; } .hint { color: #4e6170; }
label { display: block; margin: 12px 0; } input:not([type=checkbox]), select { box-sizing: border-box; width: 100%; padding: 8px; }
fieldset { border: 1px solid #ccd6df; margin: 12px 0; } button { padding: 9px 16px; cursor: pointer; } button:disabled { cursor: wait; opacity: .6; }
pre { overflow: auto; } @media (max-width: 520px) { dl { grid-template-columns: 1fr; } .fips-panel { padding: 10px; } }
</style>
