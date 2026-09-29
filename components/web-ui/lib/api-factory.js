'use strict';

const catalog = require('./api-catalog');

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, function(character) {
    return '_' + character.toLowerCase();
  });
}

function createNamespacedApi(invoke) {
  if (typeof invoke !== 'function') {
    throw new TypeError('RPC invoke function is required.');
  }

  const api = {};
  Object.keys(catalog).forEach(function(namespace) {
    const definition = catalog[namespace];
    const methods = {};

    definition.methods.forEach(function(method) {
      methods[method] = function(params) {
        return invoke(definition.module, camelToSnake(method), params || {});
      };
    });

    api[namespace] = methods;
  });

  return api;
}

module.exports = { camelToSnake, createNamespacedApi };
