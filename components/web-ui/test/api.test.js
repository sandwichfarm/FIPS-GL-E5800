'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const catalog = require('../lib/api-catalog');
const { createGlApi, resolveRpcRequest } = require('../lib/api');
const auth = require('../lib/auth');
const { createApiClient, createClient } = require('../lib/api-client');
const safeRpcMixin = require('../lib/safe-rpc-mixin');

function shape(api) {
  return Object.fromEntries(Object.keys(api).map(function(namespace) {
    return [namespace, Object.keys(api[namespace])];
  }));
}

test('catalog has the documented namespace and method counts', function() {
  const namespaces = Object.keys(catalog);
  const methods = namespaces.reduce(function(total, namespace) {
    return total + catalog[namespace].methods.length;
  }, 0);
  assert.equal(namespaces.length, 49);
  assert.equal(methods, 326);
});

test('Vue and Node APIs are generated from the same catalog', function() {
  const vueApi = createGlApi(function() { return Promise.resolve({}); });
  const nodeApi = createApiClient(function() { return Promise.resolve({}); });
  assert.deepEqual(shape(vueApi), shape(nodeApi));
});

test('Vue API converts method names and preserves RPC failures', async function() {
  const expectedError = new Error('rpc failed');
  const calls = [];
  const api = createGlApi(function(method, params) {
    calls.push([method, params]);
    return Promise.reject(expectedError);
  });

  await assert.rejects(api.system.getInfo({ detail: true }), function(error) {
    return error === expectedError;
  });
  assert.deepEqual(calls, [[
    'call',
    ['sid', 'system', 'get_info', { detail: true }],
  ]]);
});

test('Node API uses the same module and snake_case mapping', async function() {
  const calls = [];
  const api = createApiClient(function(module, method, params) {
    calls.push([module, method, params]);
    return Promise.resolve({ ok: true });
  });

  assert.deepEqual(await api.vpnClient.getAllConfigList(), { ok: true });
  assert.deepEqual(calls, [['vpn-client', 'get_all_config_list', {}]]);
});

test('authenticated Node client closes its session once and rejects later RPC calls', async function(t) {
  const originals = { login: auth.login, call: auth.call, logout: auth.logout };
  t.after(() => Object.assign(auth, originals));
  const calls = [];
  const logouts = [];
  auth.login = async () => ({ sid: 'private-session', auth: { alg: '6', name: 'sha512-crypt' } });
  auth.call = async (host, sid, module, method, params, options) => {
    calls.push({ host, sid, module, method, params, options });
    return { ok: true };
  };
  auth.logout = async (host, sid, options) => {
    logouts.push({ host, sid, options });
  };

  const options = { timeout: 2500 };
  const client = await createClient('router.test', 'private-password', 'root', options);
  assert.deepEqual(await client.system.getInfo(), { ok: true });
  await client.close();
  await client.close();

  assert.equal(calls.length, 1);
  assert.deepEqual(logouts, [{ host: 'router.test', sid: 'private-session', options }]);
  await assert.rejects(client.system.getInfo(), /API client is closed/);
});

test('Vue RPC adapter prefers the modern runtime and has an explicit legacy fallback', async function() {
  const calls = [];
  const modern = resolveRpcRequest({
    $rpcRequest(method) { calls.push(`modern:${method}`); },
    $request(method) { calls.push(`legacy:${method}`); },
  });
  modern('call');
  assert.deepEqual(calls, ['modern:call']);

  const legacy = resolveRpcRequest({
    $request(method) { calls.push(`legacy:${method}`); },
  });
  legacy('call');
  assert.deepEqual(calls, ['modern:call', 'legacy:call']);
  assert.throws(() => resolveRpcRequest({}), /RPC runtime is unavailable/);
});

test('safe RPC mixin handles modern, legacy, and missing router runtimes', async function() {
  const calls = [];
  const modern = {
    ...safeRpcMixin.methods,
    $rpcRequest(method, params) {
      calls.push(['modern', method, params]);
      return Promise.resolve({ ok: true });
    },
  };
  assert.deepEqual(await modern.safeRpc('system', 'get_info'), { ok: true });

  const legacy = {
    ...safeRpcMixin.methods,
    $request(method, params) {
      calls.push(['legacy', method, params]);
      return Promise.resolve({ ok: true });
    },
  };
  assert.deepEqual(await legacy.safeRpc('system', 'get_info'), { ok: true });
  assert.equal(await safeRpcMixin.methods.safeRpc.call({}, 'system', 'get_info'), null);
  assert.deepEqual(calls.map((call) => call[0]), ['modern', 'legacy']);
});
