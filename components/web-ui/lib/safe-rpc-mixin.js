/**
 * Safe RPC Mixin for GL.iNet plugins.
 *
 * GL.iNet's admin panel shows a global error popup ("Unknown error occurred")
 * when an RPC call fails. This mixin provides a safeRpc() method that wraps
 * $rpcRequest with proper error handling to prevent popups.
 *
 * Usage in your plugin:
 *
 *   import safeRpcMixin from 'gl-sdk4-plugin-kit/lib/safe-rpc-mixin';
 *
 *   export default {
 *     mixins: [safeRpcMixin],
 *     async created() {
 *       const info = await this.safeRpc('system', 'get_info');
 *       // info is null on error, never throws
 *     }
 *   };
 *
 * Or include directly in your component (no import needed):
 */

function getRpcRequest(vm) {
  var request = typeof vm.$rpcRequest === 'function' ? vm.$rpcRequest : vm.$request;
  if (typeof request !== 'function') {
    return function () {
      return Promise.reject(new Error('GL.iNet admin RPC runtime is unavailable.'));
    };
  }
  return request.bind(vm);
}

var safeRpcMixin = {
  methods: {
    /**
     * Safe wrapper around $rpcRequest that catches errors silently.
     * Returns null on failure instead of triggering the global error popup.
     *
     * @param {string} module - API module (e.g. "system")
     * @param {string} func - API method (e.g. "get_info")
     * @param {object} [params={}] - Call parameters
     * @returns {Promise<object|null>} API response or null on error
     */
    safeRpc: function (module, func, params) {
      return getRpcRequest(this)('call', ['sid', module, func, params || {}])
        .then(function (res) {
          return res;
        })
        .catch(function () {
          return null;
        });
    },

    /**
     * Safe RPC call that returns a default value on error.
     *
     * @param {string} module - API module
     * @param {string} func - API method
     * @param {object} [params={}] - Call parameters
     * @param {*} defaultValue - Value to return on error
     * @returns {Promise<*>} API response or defaultValue
     */
    safeRpcOr: function (module, func, params, defaultValue) {
      return getRpcRequest(this)('call', ['sid', module, func, params || {}])
        .then(function (res) {
          return res;
        })
        .catch(function () {
          return defaultValue;
        });
    },

    /**
     * Batch multiple safe RPC calls. Returns an array of results,
     * with null for any call that failed.
     *
     * @param {Array<[string, string, object?]>} calls - Array of [module, func, params?]
     * @returns {Promise<Array<object|null>>}
     */
    safeRpcBatch: function (calls) {
      var self = this;
      var promises = calls.map(function (c) {
        return self.safeRpc(c[0], c[1], c[2] || {});
      });
      return Promise.all(promises);
    },
  },
};

// Export for both import and direct inclusion
if (typeof module !== 'undefined' && module.exports) {
  module.exports = safeRpcMixin;
}
