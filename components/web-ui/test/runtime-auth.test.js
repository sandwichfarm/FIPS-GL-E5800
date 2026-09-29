'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAdminSessionHeaders,
  getAdminSessionId,
} = require('../runtime/admin-session');

test('browser auth helper reads the SDK4 cookie API and creates an explicit header', function() {
  const calls = [];
  const browser = {
    $getCookie(name) {
      calls.push(name);
      return 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
    },
  };

  assert.equal(getAdminSessionId(browser), 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6');
  assert.deepEqual(createAdminSessionHeaders(browser, { Accept: 'application/json' }), {
    Accept: 'application/json',
    'X-GL-Admin-Token': 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6',
  });
  assert.deepEqual(calls, ['Admin-Token', 'Admin-Token']);
});

test('browser auth helper rejects missing runtime and malformed sessions', function() {
  assert.throws(() => getAdminSessionId({}), /admin session is unavailable/i);
  assert.throws(
    () => getAdminSessionId({ $getCookie() { return 'short'; } }),
    /admin session is unavailable/i
  );
  assert.throws(
    () => getAdminSessionId({ $getCookie() { return 'A'.repeat(31) + '-'; } }),
    /admin session is unavailable/i
  );
});
