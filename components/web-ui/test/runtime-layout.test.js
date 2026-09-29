'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('card layout utility owns firmware internals behind public SDK classes', function() {
  const css = fs.readFileSync(path.join(root, 'runtime', 'gl-card.css'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'template', 'src', 'index.vue'), 'utf8');
  const webpack = fs.readFileSync(path.join(root, 'template', 'webpack.config.js'), 'utf8');

  assert.match(css, /\.gl-sdk4-card > \.container/);
  assert.match(css, /\.gl-sdk4-card--fill > \.container/);
  assert.match(css, /\.gl-sdk4-card__grow/);
  assert.doesNotMatch(css, /::v-deep|\/deep\/|>>>/);
  assert.match(template, /class="gl-sdk4-card"/);
  assert.match(template, /@gl-sdk4-plugin-kit\/gl-card\.css/);
  assert.match(webpack, /GL_SDK4_PLUGIN_KIT_RUNTIME/);
  assert.match(webpack, /'@gl-sdk4-plugin-kit': runtimeDir/);
});
