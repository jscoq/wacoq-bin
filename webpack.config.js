const webpack = require('webpack'),
      path = require('path');

const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const nodeExternals = require('webpack-node-externals');

const lowstats = {
    stats: {
      hash: false, version: false, modules: false  // reduce verbosity
    },
  },
  typescript = {
    module: {
      rules: [ {test: /\.tsx?$/, use: {
        loader: 'ts-loader', 
        options: {
          transpileOnly: true,  /* sorry; have to fix `wasi-kernel` probably */
          allowTsInNodeModules: true}
        }
      } ],
    },
    resolve: {
      extensions: [ '.tsx', '.ts', '.js' ],
    }
  },
  shims = {
    modules: {
      path: 'path-browserify',
      stream: 'stream-browserify',
      tty: false, url: false, worker_threads: false,
      fs: false, crypto: false
    },
    globals: {
      process: 'process/browser',
      Buffer: 'buffer'
    }
  },
  dev = (argv) => ({
    mode: 'development',
    ...(argv.mode == 'production' ? {} : {devtool: "source-map"}),
    performance: {
      maxEntrypointSize: 1e6, maxAssetSize: 1e6  /* sorry webpack, 244 KiB is just too small */
    }    
  }),
  out = (env, filename) => ({
    output: {
      filename: filename,
      path: path.join(__dirname, env.outDir || 'dist')
    }
  })

module.exports = (env, argv) => [
{
  name: 'cli',
  target: 'node',
  entry: './src/cli.ts',
  ...dev(argv),
  ...lowstats,
  externalsPresets: {node: true},
  externals: [nodeExternals()],
  ...typescript,
  ...out(env, 'ci.js'),
  plugins: [
    new webpack.BannerPlugin({banner: '#!/usr/bin/env node', raw: true}),
    new webpack.optimize.LimitChunkCountPlugin({maxChunks: 1}),
    //new BundleAnalyzerPlugin()
  ],
  node: false
},
{
  name: 'subproc',
  target: 'node',
  entry: './src/backend/subproc/index.ts',
  ...dev(argv),
  ...lowstats,
  externalsPresets: {node: true},
  externals: [nodeExternals()],
  ...typescript,
  ...out(env, 'subproc.js')
},
{
  name: 'worker',
  entry: './src/worker.ts',
  ...dev(argv),
  ...lowstats,
  ...typescript,
  resolve: {
    ...typescript.resolve,
    fallback: shims.modules
  },
  plugins: [
    new webpack.ProvidePlugin(shims.globals)    
  ],
  ...out(env, 'worker.js')
},
{
  name: 'testapp',
  entry: './src/startup.ts',
  ...dev(argv),
  ...lowstats,
  ...typescript,
  externals: {  /* for subproc, only available in NWjs */
    "child_process": "commonjs2 child_process",
    "timers": "commonjs2 timers"
  },
  resolve: {
    ...typescript.resolve,
    fallback: shims.modules
  },
  plugins: [
    new webpack.ProvidePlugin(shims.globals)    
  ],
  ...out(env, 'startup.js')
}
];
