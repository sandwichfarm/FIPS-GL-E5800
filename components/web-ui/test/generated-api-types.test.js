'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const catalog = require('../lib/api-catalog');
const {
  generateApiTypes,
  writeGeneratedTypes,
} = require('../scripts/generate-api-types');

const root = path.resolve(__dirname, '..');

test('generated API types cover the complete shared RPC catalog', function() {
  const generated = generateApiTypes({ root });
  const expectedMethodCount = Object.values(catalog).reduce(
    (total, namespace) => total + namespace.methods.length,
    0
  );

  assert.equal(generated.namespaceCount, Object.keys(catalog).length);
  assert.equal(generated.methodCount, expectedMethodCount);
  assert.equal(generated.documentedResponseCount, 18);
  assert.equal(generated.observedResponseCount, 57);
  assert.equal(generated.documentedParamCount, 23);
  assert.match(generated.rpcTypes, /export interface GlSdk4Api/);
  assert.match(
    generated.rpcTypes,
    /getInfo\(params\?: RpcParams\): Promise<SystemGetInfo>;/
  );
  assert.match(
    generated.rpcTypes,
    /getLoad\(params\?: RpcParams\): Promise<SystemGetLoadObservedResponse>;/
  );
  assert.match(generated.rpcTypes, /"memory_free"\?: unknown;/);
  assert.match(
    generated.rpcTypes,
    /setPassword\(params: SetPasswordParams\): Promise<unknown>;/
  );
  assert.match(
    generated.rpcTypes,
    /connect\(params: RepeaterConnectParams\): Promise<unknown>;/
  );
});

test('committed declarations match their catalog, fixtures, and JSDoc sources', function() {
  const generated = writeGeneratedTypes({ root, check: true });

  assert.equal(
    fs.readFileSync(path.join(root, 'rpc-api.d.ts'), 'utf8'),
    generated.rpcTypes
  );
  assert.equal(
    fs.readFileSync(path.join(root, 'lib', 'types.d.ts'), 'utf8'),
    generated.jsdocTypes
  );
});
