const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi, sessionHeaders } = require('../src/api.cjs');

test('requires a real admin session, never falls back to unauthenticated fetch', async () => {
  let called = false;
  const api = createApi({}, async () => { called = true; });
  await assert.rejects(api('status'), /Sign in/);
  assert.equal(called, false);
});

test('sends structured JSON and session header to same-origin CGI', async () => {
  const browser = { $getCookie: () => 'a'.repeat(32) };
  const api = createApi(browser, async (url, options) => {
    assert.equal(url, '/cgi-bin/gl-sdk4-ui-fips');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers['X-GL-Admin-Token'], 'a'.repeat(32));
    assert.equal(JSON.parse(options.body).operation, 'configuration');
    return { ok: true, status: 200, json: async () => ({ status: 'ok', data: { revision: 'abc' } }) };
  });
  assert.deepEqual(await api('configuration'), { revision: 'abc' });
});

test('backend validation and HTTP authorization failures surface as errors', async () => {
  const browser = { $getCookie: () => 'a'.repeat(32) };
  await assert.rejects(createApi(browser, async () => ({ status: 403 }))('stage'), /access denied/);
  await assert.rejects(createApi(browser, async () => ({ ok: true, status: 200,
    json: async () => ({ status: 'error', error: 'revision_conflict' }) }))('stage'), /revision_conflict/);
  assert.throws(() => sessionHeaders({ $getCookie: () => ';'.repeat(32) }), /expired/);
});
