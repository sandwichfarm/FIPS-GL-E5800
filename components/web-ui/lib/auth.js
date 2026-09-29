'use strict';

/**
 * GL.iNet SDK4 RPC authentication.
 *
 * Confirmed against the official 4.8.1 release and 4.9.0 beta6 UI bundles:
 *   challenge -> Unix crypt selected by challenge.alg -> SHA-256 -> login.
 */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const AUTH_ALGORITHMS = Object.freeze({
  '1': Object.freeze({ name: 'md5-crypt', opensslFlag: '-1', saltLength: 8 }),
  '5': Object.freeze({ name: 'sha256-crypt', opensslFlag: '-5', saltLength: 16 }),
  '6': Object.freeze({ name: 'sha512-crypt', opensslFlag: '-6', saltLength: 16 }),
});

class RpcError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'RpcError';
    if (details) {
      if (details.code !== undefined) this.code = details.code;
      if (details.data !== undefined) this.data = details.data;
      if (details.httpStatus !== undefined) this.httpStatus = details.httpStatus;
      if (details.cause !== undefined) this.cause = details.cause;
    }
  }
}

class UnsupportedAuthAlgorithmError extends Error {
  constructor(alg) {
    super(`Unsupported router authentication algorithm: ${String(alg)}`);
    this.name = 'UnsupportedAuthAlgorithmError';
    this.alg = String(alg);
  }
}

function normalizeRouterUrl(host, options) {
  if (typeof host !== 'string' || !host.trim()) {
    throw new TypeError('Router host is required.');
  }

  const settings = options || {};
  const input = /^[a-z][a-z\d+.-]*:\/\//i.test(host)
    ? host
    : `${settings.https ? 'https' : 'http'}://${host}`;

  let url;
  try {
    url = new URL(input);
  } catch (error) {
    throw new TypeError(`Invalid router host: ${host}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`Unsupported router protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new TypeError('Router URL must not contain credentials.');
  }

  url.pathname = '/rpc';
  url.search = '';
  url.hash = '';
  return url;
}

/**
 * Send a JSON-RPC request to the router.
 * HTTPS certificates are verified unless the caller explicitly sets insecure.
 */
function rpcCall(host, body, options) {
  const settings = options || {};
  const endpoint = normalizeRouterUrl(host, settings);
  const transport = settings.transport || (endpoint.protocol === 'https:' ? https : http);
  const timeout = settings.timeout === undefined ? 10000 : settings.timeout;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const request = transport.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port || undefined,
        path: endpoint.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        rejectUnauthorized: settings.insecure !== true,
        timeout,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          let json;

          try {
            json = JSON.parse(responseText);
          } catch (error) {
            reject(new RpcError('Invalid JSON response from router.', {
              httpStatus: response.statusCode,
              cause: error,
            }));
            return;
          }

          if (json.error) {
            reject(new RpcError(json.error.message || 'Router RPC error.', {
              code: json.error.code,
              data: json.error.data,
              httpStatus: response.statusCode,
            }));
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new RpcError(`Router returned HTTP ${response.statusCode}.`, {
              httpStatus: response.statusCode,
            }));
            return;
          }

          resolve(json.result);
        });
      }
    );

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new RpcError(`Router connection timed out after ${timeout} ms.`));
    });
    request.end(data);
  });
}

function normalizeAlgorithm(alg) {
  const id = String(alg);
  const algorithm = AUTH_ALGORITHMS[id];
  if (!algorithm) throw new UnsupportedAuthAlgorithmError(id);
  return { id, ...algorithm };
}

function validateChallenge(challenge) {
  if (!challenge || typeof challenge !== 'object') {
    throw new RpcError('Router returned an invalid authentication challenge.');
  }
  if (typeof challenge.salt !== 'string' || !challenge.salt) {
    throw new RpcError('Router authentication challenge has no salt.');
  }
  if (typeof challenge.nonce !== 'string' || !challenge.nonce) {
    throw new RpcError('Router authentication challenge has no nonce.');
  }
  if (!/^[./0-9A-Za-z]+$/.test(challenge.salt)) {
    throw new RpcError('Router authentication challenge contains an invalid salt.');
  }

  return {
    alg: normalizeAlgorithm(challenge.alg),
    salt: challenge.salt,
    nonce: challenge.nonce,
  };
}

/**
 * Compute the Unix crypt stage without placing the password in argv or a shell.
 */
function unixCrypt(password, salt, alg, options) {
  if (typeof password !== 'string') throw new TypeError('Router password must be a string.');
  if (password.includes('\n') || password.includes('\r')) {
    throw new TypeError('Router password must not contain line breaks.');
  }

  const algorithm = normalizeAlgorithm(alg);
  const effectiveSalt = salt.slice(0, algorithm.saltLength);
  const run = options && options.spawnSync ? options.spawnSync : spawnSync;
  const result = run(
    'openssl',
    ['passwd', algorithm.opensslFlag, '-salt', effectiveSalt, '-stdin'],
    {
      input: `${password}\n`,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }
  );

  if (result.error) {
    throw new Error(`Unable to run openssl for router authentication: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim();
    throw new Error(`openssl password hashing failed${detail ? `: ${detail}` : '.'}`);
  }

  const crypted = String(result.stdout || '').trim();
  if (!crypted.startsWith(`$${algorithm.id}$${effectiveSalt}$`)) {
    throw new Error('openssl returned an unexpected Unix crypt result.');
  }
  return crypted;
}

function createLoginHash(username, password, challenge, options) {
  if (typeof username !== 'string' || !username) throw new TypeError('Router username is required.');
  const normalized = validateChallenge(challenge);
  const crypted = unixCrypt(password, normalized.salt, normalized.alg.id, options);
  const hash = crypto
    .createHash('sha256')
    .update(`${username}:${crypted}:${normalized.nonce}`, 'utf8')
    .digest('hex');

  return { hash, algorithm: normalized.alg };
}

async function getChallenge(host, username, options) {
  const result = await rpcCall(host, {
    jsonrpc: '2.0',
    id: 1,
    method: 'challenge',
    params: { username: username || 'root' },
  }, options);

  return validateChallenge(result);
}

/** Authenticate with a GL.iNet router through the SDK4 HTTP RPC endpoint. */
async function login(host, password, username, options) {
  const account = username || 'root';
  const settings = options || {};
  const challenge = settings.challenge
    ? validateChallenge(settings.challenge)
    : await getChallenge(host, account, settings);
  const credentials = createLoginHash(account, password, {
    alg: challenge.alg.id,
    salt: challenge.salt,
    nonce: challenge.nonce,
  }, settings);

  const result = await rpcCall(host, {
    jsonrpc: '2.0',
    id: 2,
    method: 'login',
    params: { username: account, hash: credentials.hash },
  }, settings);

  if (!result || typeof result.sid !== 'string' || !result.sid) {
    throw new RpcError('Router login response has no session ID.');
  }

  return {
    sid: result.sid,
    host,
    auth: {
      alg: credentials.algorithm.id,
      name: credentials.algorithm.name,
    },
  };
}

/** Make an authenticated SDK4 RPC call. */
async function call(host, sid, module, func, params, options) {
  return rpcCall(host, {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'call',
    params: [sid, module, func, params || {}],
  }, options);
}

/** End an authenticated SDK4 RPC session. */
async function logout(host, sid, options) {
  if (typeof sid !== 'string' || !sid) throw new TypeError('Router session ID is required.');
  return rpcCall(host, {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'logout',
    params: { sid },
  }, options);
}

module.exports = {
  AUTH_ALGORITHMS,
  RpcError,
  UnsupportedAuthAlgorithmError,
  call,
  createLoginHash,
  getChallenge,
  login,
  logout,
  normalizeRouterUrl,
  rpcCall,
  unixCrypt,
  validateChallenge,
};
