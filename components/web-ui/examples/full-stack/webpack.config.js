const path = require('path');
const { VueLoaderPlugin } = require('vue-loader');
const manifest = require('./gl-plugin.json');
const runtimeDir = process.env.GL_SDK4_PLUGIN_KIT_RUNTIME;
const views = manifest.views || [
  { id: manifest.id, entry: 'src/index.vue', menu: 'menu.json' },
];

module.exports = {
  mode: 'production',
  entry: Object.fromEntries(views.map((view) => [view.id, `./${view.entry}`])),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'gl-sdk4-ui-[name].common.js',
    libraryTarget: 'commonjs2',
    libraryExport: 'default',
  },
  externals: { vue: 'vue' },
  module: {
    rules: [
      { test: /\.vue$/, loader: 'vue-loader' },
      { test: /\.js$/, loader: 'babel-loader', exclude: /node_modules/ },
      { test: /\.css$/, use: ['vue-style-loader', 'css-loader'] },
    ],
  },
  plugins: [new VueLoaderPlugin()],
  resolve: {
    extensions: ['.js', '.vue'],
    alias: runtimeDir ? { '@gl-sdk4-plugin-kit': runtimeDir } : {},
  },
};
