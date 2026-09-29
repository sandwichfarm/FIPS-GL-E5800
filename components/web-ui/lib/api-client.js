'use strict';

const auth = require('./auth');
const { createNamespacedApi } = require('./api-factory');

function createApiClient(rpc) {
  return createNamespacedApi(rpc);
}

/**
 * Create an authenticated standalone SDK4 API client.
 *
 * @param {string} host Router IP or hostname
 * @param {string} password Admin password
 * @param {string} [username="root"] Username
 * @param {object} [options] RPC transport options (`https`, `insecure`, `timeout`)
 * @returns {Promise<object>} Authenticated namespaced API client
 */
async function createClient(host, password, username, options) {
  const session = await auth.login(host, password, username || 'root', options);
  let state = 'open';
  let closePromise = null;

  function rpc(module, method, params) {
    if (state !== 'open') return Promise.reject(new Error('API client is closed.'));
    return auth.call(host, session.sid, module, method, params || {}, options);
  }

  function close() {
    if (state === 'closed') return Promise.resolve();
    if (closePromise) return closePromise;
    state = 'closing';
    closePromise = auth.logout(host, session.sid, options).then(
      () => {
        state = 'closed';
      },
      (error) => {
        state = 'open';
        closePromise = null;
        throw error;
      }
    );
    return closePromise;
  }

  return Object.assign(
    {
      sid: session.sid,
      host: host,
      auth: session.auth,
      rpc: rpc,
      close: close,
    },
    createApiClient(rpc)
  );
}

module.exports = { createApiClient, createClient };
