const path = require('node:path');
const base = require('./webpack.config.cjs');

module.exports = {
  ...base,
  mode: 'development',
  entry: './preview/main.js',
  externals: {},
  output: {
    path: path.resolve(__dirname, '../../.cache/web-preview'),
    filename: 'preview.js',
  },
};
