/**
 * 基础配置
 */
import webpack, { Configuration, RuleSetRule } from 'webpack'
import path from 'path'

import { Extensions } from '../constants'
import { message, IS_CI } from '../utils'

import { WebpackConfigurer } from './type'
import devConfig from './dev.config'
import prodConfig from './prod.config'
import getBabelOptions from './utils/babelOptions'
import genCacheConfig from './utils/cacheOptions'
import styleLoaders from './utils/styleLoaders'
import { getEntries } from './utils/entry'
import getForkTsCheckerOptions from './utils/forkTsCheckerOption'
import eslintConfig from './utils/eslintConfig'
import InjectEnvPlugin from './plugins/HtmlInjectedEnvironments'
import HtmlInterpolatePlugin from './plugins/HtmlInterpolate'
import WatchMissingNodeModulesPlugin from './plugins/WatchMissingNodeModulesPlugin'
import { ExternalWhiteList } from './constants'

const nodeExternals = require('webpack-node-externals')
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin')
const WebpackModules = require('webpack-modules')
const Es3ifyPlugin = require('es3ify-webpack-plugin')
const OfflinePlugin = require('offline-plugin')

const configure: WebpackConfigurer = (enviroments, pkg, paths, argv) => {
  const { name, entry } = argv
  const isProduction = enviroments.raw.NODE_ENV === 'production'
  const $ = <D, P>(development: D, production: P) => (isProduction ? production : development)

  const envConfig = $(devConfig, prodConfig)(enviroments, pkg, paths, argv)
  const context = paths.appSrc
  const isElectron = argv.jmOptions.electron
  const isIE8 = argv.jmOptions.ie8
  let { entries, templatePlugins } = getEntries({
    context,
    entry,
    isProduction,
    electron: isElectron,
    templateParameters: enviroments.raw,
    hotreload: !isIE8,
    inject: argv.jmOptions.inject!,
  })
  const filePrefix = name ? `${name}_` : ''
  const shouldUseSourceMap = enviroments.raw.SOURCE_MAP !== 'false'

  entries = {
    // inject entries
    ...(envConfig.entry as object),
    ...entries,
  }

  message.info(`entries: ${Object.keys(entries).join(', ')}`)

  if (!argv.jmOptions.enableTypescriptCheck) {
    message.info(`Typescript check was disabled`)
  }

  const babelOptions = getBabelOptions(enviroments.raw, argv.jmOptions, paths)

  const babelLoders = [
    // should I use cache-loader here? see more in https://github.com/webpack-contrib/cache-loader/issues/1#issuecomment-297994952
    {
      loader: require.resolve('babel-loader'),
      options: babelOptions,
    },
  ]

  const webpackConfig: Configuration = {
    name: name || (isElectron ? 'renderer' : ''),
    bail: envConfig.bail,
    context,
    mode: $('development', 'production'),
    devtool: envConfig.devtool,
    entry: entries,
    target: isElectron ? 'electron-renderer' : 'web',
    output: {
      filename: `static/js/${filePrefix}[name].js${$('', '?[chunkhash:8]')}`,
      chunkFilename: `static/js/${filePrefix}[name].js${$('', '?[chunkhash:8]')}`,
      path: paths.appDist,
      pathinfo: !isProduction,
      publicPath: enviroments.raw.PUBLIC_URL,
      // Point sourcemap entries to original disk location (format as URL on Windows)
      devtoolModuleFilenameTemplate: isProduction
        ? info => path.relative(paths.appSrc, info.absoluteResourcePath).replace(/\\/g, '/')
        : info => path.resolve(info.absoluteResourcePath).replace(/\\/g, '/'),
      libraryTarget: isElectron ? 'commonjs2' : undefined,
    },
    externals: isElectron
      ? [
          nodeExternals({
            whitelist: ExternalWhiteList,
            modulesFromFile: {
              include: ['dependencies'],
            },
          }),
        ]
      : undefined,
    resolve: {
      modules: ['node_modules'],
      extensions: Extensions,
      alias: {
        ...(argv.jmOptions.alias || {}),
        // 可以直接使用~访问相对于源代码目录的模块，优化查找效率
        // 如 ~/components/Button
        '~': context,
      },
    },
    resolveLoader: {
      modules: [paths.ownNodeModules, 'node_modules'],
    },
    module: {
      strictExportPresence: true,
      rules: [
        { parser: { requireEnsure: false } },
        // eslint
        (!isProduction ? !!argv.jmOptions.enableESlint : !!argv.jmOptions.enableESlintInProduction) && {
          test: /\.(js|jsx|ts|tsx)$/,
          enforce: 'pre',
          use: [
            {
              options: eslintConfig(paths),
              loader: require.resolve('eslint-loader'),
            },
          ],
          include: paths.appSrc,
        },
        {
          oneOf: [
            // typescript & js
            {
              test: /\.(ts|tsx|js|jsx)$/,
              exclude: {
                test: /node_modules/,
                exclude: /@gzbapp/,
              },
              use: [
                {
                  loader: require.resolve('cache-loader'),
                  options: genCacheConfig('babel-loader-render', enviroments.raw, paths),
                },
                ...babelLoders,
              ],
            },
            {
              test: /\.css$/,
              use: [
                ...styleLoaders(
                  enviroments.raw,
                  {
                    cssOption: {
                      importLoaders: 1,
                      sourceMap: isProduction && shouldUseSourceMap,
                    },
                    ie8: isIE8,
                  },
                  undefined,
                  undefined,
                ),
              ],
              sideEffects: true,
            },
            // pug loader
            {
              test: /\.pug$/,
              use: [
                {
                  loader: require.resolve('pug-loader'),
                  options: {
                    root: context,
                  },
                },
              ],
            },
            // svg 可以获取链接，也可以转换为React组件
            {
              test: /\.svg$/,
              exclude: /fonts?/,
              issuer: {
                test: /\.(tsx|jsx|js|ts)$/,
              },
              use: [
                { loader: require.resolve('babel-loader'), options: babelOptions },
                {
                  loader: require.resolve('@svgr/webpack'),
                  options: {
                    icon: true,
                    svgo: true,
                    prettier: false,
                    babel: false,
                    svgProps: { fill: 'currentColor' },
                    expandProps: 'end',
                  },
                },
                {
                  loader: require.resolve('url-loader'),
                  options: {
                    limit: isIE8 ? false : 10000,
                    name: `static/media/${filePrefix}[name].[ext]${$('', '?[hash:8]')}`,
                  },
                },
              ],
            },
            // images
            {
              test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/, /\.svg$/],
              loader: require.resolve('url-loader'),
              options: {
                limit: isIE8 ? false : 10000,
                name: `static/media/${filePrefix}[name].[ext]${$('', '?[hash:8]')}`,
              },
            },
            // 其他loader插入到这里
            ...((envConfig.module && envConfig.module.rules) || []),
            {
              // Exclude `js` files to keep "css" loader working as it injects
              // its runtime that would otherwise be processed through "file" loader.
              // Also exclude `html` and `json` extensions so they get processed
              // by webpacks internal loaders.
              exclude: [/\.(ts|tsx|js|jsx|mjs)$/, /\.html$/, /\.json$/],
              loader: require.resolve('file-loader'),
              options: {
                name: `static/media/${filePrefix}[name].[ext]${$('', '?[hash:8]')}`,
              },
            },
          ],
        },
      ].filter(Boolean) as RuleSetRule[],
    },
    optimization: {
      concatenateModules: isIE8 ? true : undefined,
      ...(envConfig.optimization || {}),
    },
    plugins: [
      new WebpackModules(),
      isIE8 && new Es3ifyPlugin(),
      (isProduction
        ? argv.jmOptions.enableTypescriptCheckInProduction
        : argv.jmOptions.enableTypescriptCheck || IS_CI) &&
        // typescript type checker
        new ForkTsCheckerWebpackPlugin(
          getForkTsCheckerOptions(paths, enviroments.raw, argv.jmOptions, {
            watch: paths.appSrc,
            reportFiles: [
              `**/*.@(ts|tsx)`,
              !isProduction && `!${path.basename(paths.appElectronMain)}/**/*`, // 忽略electron main
              '!**/__tests__/**',
              '!**/?(*.)(spec|test).*',
            ].filter(Boolean),
          }),
        ),
      // 移除moment语言包
      new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
      new webpack.DefinePlugin(enviroments.stringified),
      // 监听丢失的模块. 如果没有这个插件, 一旦没有找到对应的模块, 将需要重启webpack.
      // 在使用link 模块时比较有用
      new WatchMissingNodeModulesPlugin(paths.appNodeModules),
      // html-webpack-plugin
      ...templatePlugins,
      // 注入环境变量到 window.JM_ENV中
      new InjectEnvPlugin(enviroments.userDefine, 'JM_ENV'),
      // 解析html里面的${ENV}
      new HtmlInterpolatePlugin(enviroments.raw),
      ...(envConfig.plugins || []),
      // 离线模式
      !isIE8 &&
        !isElectron &&
        argv.jmOptions.offline &&
        (!isProduction ? argv.jmOptions.enableOfflineInDev : true) &&
        new OfflinePlugin(argv.jmOptions.offlineOptions),
    ].filter(Boolean),
    node: isElectron
      ? false
      : {
          dgram: 'empty',
          fs: 'empty',
          net: 'empty',
          tls: 'empty',
          child_process: 'empty',
        },
    performance: envConfig.performance,
  }

  return webpackConfig
}

export default configure
