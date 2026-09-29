'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Readable } = require('node:stream');
const test = require('node:test');
const vectors = require('./fixtures/auth-vectors.json');
const { promptHidden, readPasswordFromStream } = require('../lib/prompt');
const {
  RpcError,
  call,
  createLoginHash,
  login,
  logout,
  normalizeRouterUrl,
  unixCrypt,
} = require('../lib/auth');

test('auth vectors cover every algorithm supported by official 4.8 and 4.9 UI bundles', function() {
  vectors.vectors.forEach(function(vector) {
    assert.equal(unixCrypt(vectors.password, vectors.salt, vector.alg), vector.crypted);
    const result = createLoginHash(vectors.username, vectors.password, {
      alg: vector.alg,
      salt: vectors.salt,
      nonce: vectors.nonce,
    });
    assert.equal(result.algorithm.name, vector.name);
    assert.equal(result.hash, vector.login_hash);
  });
});

test('openssl receives the password through stdin and never through argv', function() {
  const password = "not-in-argv '$() with spaces";
  const expected = '$1$saltsalt$fixture';
  const actual = unixCrypt(password, 'saltsalt', '1', {
    spawnSync(command, args, options) {
      assert.equal(command, 'openssl');
      assert.deepEqual(args, ['passwd', '-1', '-salt', 'saltsalt', '-stdin']);
      assert.equal(args.includes(password), false);
      assert.equal(options.input, `${password}\n`);
      return { status: 0, stdout: `${expected}\n`, stderr: '' };
    },
  });
  assert.equal(actual, expected);
});

test('unknown challenge algorithms fail explicitly', function() {
  assert.throws(function() {
    createLoginHash('root', 'password', { alg: '9', salt: 'salt', nonce: 'nonce' });
  }, /Unsupported router authentication algorithm: 9/);
});

test('--password-stdin reads one secret line without putting it in CLI arguments', async function() {
  assert.equal(await readPasswordFromStream(Readable.from(['streamed-secret\n'])), 'streamed-secret');
  await assert.rejects(readPasswordFromStream(Readable.from(['\n'])), /No router password/);
});

test('hidden password prompt releases a TTY that was not already flowing', async function() {
  const input = new PassThrough();
  const output = new PassThrough();
  const rawModes = [];
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = function(enabled) {
    this.isRaw = enabled;
    rawModes.push(enabled);
  };

  assert.equal(input.readableFlowing, null);
  const passwordPromise = promptHidden('Secret: ', { input, output });
  input.write('hidden-secret\n');

  assert.equal(await passwordPromise, 'hidden-secret');
  assert.deepEqual(rawModes, [true, false]);
  assert.equal(input.readableFlowing, false);
  assert.equal(input.listenerCount('data'), 0);
});

test('HTTP RPC login and authenticated calls preserve structured errors', async function() {
  const requests = [];
  const transport = {
    request(options, onResponse) {
      assert.equal(options.hostname, 'router.test');
      assert.equal(options.path, '/rpc');
      const request = new EventEmitter();
      request.end = function(data) {
        const body = JSON.parse(data);
        let payload;
      requests.push(body);

      if (body.method === 'challenge') {
          payload = {
          jsonrpc: '2.0', id: body.id,
          result: { alg: 1, salt: vectors.salt, nonce: vectors.nonce },
          };
      } else if (body.method === 'login') {
        assert.equal(body.params.hash, vectors.vectors[0].login_hash);
          payload = { jsonrpc: '2.0', id: body.id, result: { sid: 'test-session' } };
      } else if (body.method === 'logout') {
        assert.deepEqual(body.params, { sid: 'test-session' });
        payload = { jsonrpc: '2.0', id: body.id, result: {} };
      } else if (body.params[1] === 'system') {
          payload = { jsonrpc: '2.0', id: body.id, result: { firmware_version: '4.9.0' } };
      } else {
          payload = {
          jsonrpc: '2.0', id: body.id,
          error: { code: -32601, message: 'Method not found', data: { module: body.params[1] } },
          };
      }

        const response = Readable.from([JSON.stringify(payload)]);
        response.statusCode = 200;
        onResponse(response);
      };
      return request;
    },
  };

  const host = 'http://router.test';
  const options = { transport };
  const session = await login(host, vectors.password, 'root', options);

  assert.equal(session.sid, 'test-session');
  assert.deepEqual(session.auth, { alg: '1', name: 'md5-crypt' });
  assert.deepEqual(await call(host, session.sid, 'system', 'get_info', {}, options), { firmware_version: '4.9.0' });
  await assert.rejects(call(host, session.sid, 'missing', 'get_status', {}, options), function(error) {
    assert.equal(error instanceof RpcError, true);
    assert.equal(error.code, -32601);
    assert.deepEqual(error.data, { module: 'missing' });
    return true;
  });
  assert.deepEqual(await logout(host, session.sid, options), {});
  assert.deepEqual(
    requests.map((request) => request.method),
    ['challenge', 'login', 'call', 'call', 'logout']
  );
});

test('router URLs preserve explicit ports and reject embedded credentials', function() {
  assert.equal(normalizeRouterUrl('router.local:8443', { https: true }).href, 'https://router.local:8443/rpc');
  assert.throws(() => normalizeRouterUrl('http://root:secret@router.local'), /must not contain credentials/);
});
