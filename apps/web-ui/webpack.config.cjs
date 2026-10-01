const path = require('node:path');
const webpack = require('webpack');
const { VueLoaderPlugin } = require('vue-loader');
const { wrapBundleForEval } = require('../../components/web-ui/lib/build');

class RouterEvalExportPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('RouterEvalExportPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'RouterEvalExportPlugin', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER },
        () => {
          const name = 'gl-sdk4-ui-fips.common.js';
          const asset = compilation.getAsset(name);
          if (asset) {
            compilation.updateAsset(name, new webpack.sources.RawSource(
              wrapBundleForEval(asset.source.source().toString())
            ));
          }
        }
      );
    });
  }
}

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
  plugins: [new VueLoaderPlugin(), new RouterEvalExportPlugin()],
  resolve: { extensions: ['.js', '.cjs', '.vue'] },
};
