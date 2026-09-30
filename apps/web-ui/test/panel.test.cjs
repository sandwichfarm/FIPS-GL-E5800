const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseComponent } = require('vue-template-compiler');

const source = fs.readFileSync(path.join(__dirname, '../src/Fips.vue'), 'utf8');
const script = parseComponent(source).script.content.replace('export default', 'module.exports =');
const moduleContext = { exports: {} };
vm.runInNewContext(script, {
  module: moduleContext,
  require: () => ({ createApi: () => { throw new Error('Unexpected browser API call'); } }),
});
const panel = moduleContext.exports;

function instance(request) {
  const state = panel.data();
  state.request = request;
  state.refresh = panel.methods.refresh.bind(state);
  return state;
}

test('failed refresh hides stale online data and configuration', async () => {
  let fail = false;
  const state = instance(async operation => {
    if (fail) throw new Error('Router request failed.');
    if (operation === 'status') return { state: 'online', npub: 'npub1old', peer_count: 1 };
    if (operation === 'configuration') return {
      revision: 'old', settings: { mesh_tcp_ports: [], mesh_udp_ports: [], peers: [] },
    };
    if (operation === 'recovery') return { pending: false };
    if (operation === 'peers') return { peers: [{ npub: 'npub1old' }] };
    throw new Error(`Unexpected operation: ${operation}`);
  });
  await state.refresh();
  assert.equal(state.status.state, 'online');
  assert.equal(state.peers.length, 1);
  assert.ok(state.settings);

  fail = true;
  await state.refresh();
  assert.equal(state.error, 'Router request failed.');
  assert.equal(state.status.state, undefined);
  assert.equal(state.peers.length, 0);
  assert.equal(state.settings, null);
  assert.equal(state.revision, '');
  assert.equal(state.busy, false);
});

test('peer request failure never publishes a partially refreshed node', async () => {
  const state = instance(async operation => {
    if (operation === 'status') return { state: 'online', npub: 'npub1new' };
    if (operation === 'configuration') return {
      revision: 'new', settings: { mesh_tcp_ports: [], mesh_udp_ports: [], peers: [] },
    };
    if (operation === 'recovery') return { pending: false };
    throw new Error('Peers unavailable.');
  });
  await state.refresh();
  assert.equal(state.error, 'Peers unavailable.');
  assert.equal(state.status.npub, undefined);
  assert.equal(state.settings, null);
});
