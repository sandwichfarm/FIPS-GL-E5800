const path = require('node:path');
const { VueLoaderPlugin } = require('vue-loader');

module.exports = {
  mode: 'production',
  entry: './src/Fips.vue',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'gl-sdk4-ui-fips.common.js',
    libraryTarget: 'commonjs2',
    libraryExport: 'default',
  },
  externals: { vue: 'vue' },
  module: { rules: [
    { test: /\.vue$/, loader: 'vue-loader' },
    { test: /\.css$/, use: ['vue-style-loader', 'css-loader'] },
  ] },
  plugins: [new VueLoaderPlugin()],
  resolve: { extensions: ['.js', '.cjs', '.vue'] },
};
