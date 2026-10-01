const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const { inspectBundleExport } = require('../../../components/web-ui/lib/test');

test('production bundle evaluates to a Vue component in the router loader', () => {
  const source = fs.readFileSync(path.join(__dirname, '../dist/gl-sdk4-ui-fips.common.js'));
  const result = inspectBundleExport(zlib.gzipSync(source));
  assert.deepEqual(result, { ok: true, detail: 'eval() returned a Vue component' });
});
