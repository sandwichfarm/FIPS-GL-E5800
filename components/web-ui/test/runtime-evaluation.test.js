'use strict';

const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const zlib = require('node:zlib');
const { promptHidden } = require('../lib/prompt');
const { inspectBundleExport } = require('../lib/test');

test('bundle verification exposes browser text codecs to dependency bundles', function() {
  const source = [
    '(function () {',
    '  var bytes = new TextEncoder().encode("router");',
    '  if (new TextDecoder().decode(bytes) !== "router") throw new Error("codec failed");',
    '  return { name: "codec-fixture" };',
    '})()',
  ].join('\n');
  const result = inspectBundleExport(zlib.gzipSync(Buffer.from(source)));
  assert.deepEqual(result, { ok: true, detail: 'eval() returned a Vue component' });
});

test('hidden prompt disables terminal echo before displaying its question', async function() {
  const input = new PassThrough();
  const output = new PassThrough();
  const rawModes = [];
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = function(enabled) {
    this.isRaw = enabled;
    rawModes.push(enabled);
  };

  output.once('data', function() {
    assert.equal(input.isRaw, true);
    input.write('hidden-secret\n');
  });
  assert.equal(await promptHidden('Secret: ', { input, output }), 'hidden-secret');
  assert.deepEqual(rawModes, [true, false]);
});
