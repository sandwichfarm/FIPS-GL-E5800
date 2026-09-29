'use strict';

const { createNamespacedApi } = require('./api-factory');

/**
 * Create the namespaced SDK4 API for a Vue plugin.
 * RPC rejections are preserved so callers can distinguish failures from empty data.
 *
 * @param {function} rpc Vue $rpcRequest-compatible function
 * @returns {object} Namespaced API
 */
function createGlApi(rpc) {
  return createNamespacedApi(function(module, method, params) {
    return rpc('call', ['sid', module, method, params]);
  });
}

function resolveRpcRequest(vm) {
  if (vm && typeof vm.$rpcRequest === 'function') return vm.$rpcRequest.bind(vm);
  if (vm && typeof vm.$request === 'function') return vm.$request.bind(vm);
  throw new Error('GL.iNet admin RPC runtime is unavailable.');
}

const glApiMixin = {
  beforeCreate: function() {
    const rpcRequest = resolveRpcRequest(this);
    this.glApi = createGlApi((method, params) => rpcRequest(method, params));
  }
};

exports.createGlApi = createGlApi;
exports.glApiMixin = glApiMixin;
exports.resolveRpcRequest = resolveRpcRequest;
