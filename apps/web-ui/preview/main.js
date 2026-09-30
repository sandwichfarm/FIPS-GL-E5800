const Vue = require('vue');
const FipsPanel = require('../src/Fips.vue').default;

const token = 'a'.repeat(32);
const initialSettings = {
  enabled: true,
  gateway_enabled: false,
  udp_port: 2121,
  tcp_port: 8443,
  peers: [],
  mesh_tcp_ports: [],
  mesh_udp_ports: [],
};
const copy = value => JSON.parse(JSON.stringify(value));
const preview = {
  settings: copy(initialSettings),
  revision: 'preview-1',
  staged: null,
  previous: null,
  pending: false,
  offline: false,
  error: false,
};

window.$getCookie = name => name === 'Admin-Token' ? token : '';
window.previewMode = mode => {
  preview.offline = mode === 'offline';
  preview.error = mode === 'error';
  document.getElementById('preview-mode').textContent = mode;
  const refresh = document.querySelector('.fips-panel header button');
  if (refresh) refresh.click();
};

function answer(data, status = 200) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => data };
}
function ok(data) { return answer({ status: 'ok', data }); }
function fail(error) { return answer({ status: 'error', error }); }

window.fetch = async (url, options) => {
  if (url !== '/cgi-bin/gl-sdk4-ui-fips' || options.method !== 'POST' ||
      options.headers['X-GL-Admin-Token'] !== token) {
    return answer({ status: 'error', error: 'unauthorized' }, 403);
  }
  if (preview.error) return answer({ status: 'error', error: 'preview_unavailable' }, 503);
  const request = JSON.parse(options.body);
  switch (request.operation) {
    case 'status':
      return ok({ state: preview.offline ? 'offline' : 'running',
        npub: 'npub1syntheticpreviewonly', ipv6_addr: 'fd00::1',
        peer_count: 0, persistent: true });
    case 'peers': return ok({ peers: [] });
    case 'configuration': return ok({ settings: copy(preview.settings), revision: preview.revision });
    case 'recovery': return ok({ pending: preview.pending,
      mode: preview.pending ? 'config_only' : '', transaction_id: preview.pending ? 'preview_tx' : '' });
    case 'diagnostics': return ok({ daemon_reachable: !preview.offline,
      configuration_valid: true, preview: true });
    case 'stage':
      if (request.expected_revision !== preview.revision) return fail('revision_conflict');
      if (!request.settings || request.settings.udp_port < 1024 || request.settings.tcp_port < 1024) {
        return fail('invalid_configuration');
      }
      preview.staged = copy(request.settings);
      return ok({ revision: 'preview-candidate' });
    case 'activate':
      if (request.expected_revision !== 'preview-candidate' || !preview.staged || preview.pending) {
        return fail('candidate_missing');
      }
      preview.previous = copy(preview.settings);
      preview.settings = preview.staged;
      preview.staged = null;
      preview.revision = 'preview-2';
      preview.pending = true;
      return ok({ transaction_id: 'preview_tx' });
    case 'confirm':
      if (!preview.pending || request.transaction_id !== 'preview_tx') return fail('transaction_not_pending');
      preview.pending = false;
      preview.previous = null;
      return ok({ confirmed: true });
    case 'rollback':
      if (!preview.pending || request.transaction_id !== 'preview_tx') return fail('transaction_not_pending');
      preview.settings = preview.previous;
      preview.previous = null;
      preview.pending = false;
      preview.revision = 'preview-3';
      return ok({ rolled_back: true });
    default: return fail('unsupported_operation');
  }
};

new Vue({ render: create => create(FipsPanel) }).$mount('#app');
