/**
 * @file 整体逻辑就是配置esbuild的输出路径，入口文件，编译模式，拆包，外部依赖处理，定义一些方便项目使用的全局变量
 */

// @ts-check
// Using esbuild for faster dev builds.
// We are still using Rollup for production builds because it generates
// smaller files and provides better tree-shaking.

import esbuild from 'esbuild'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'
import minimist from 'minimist'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// import.meta是当前模块的元数据对象，url是指当前模块的文件路径(如果不是英文路径，会被url编码)
// createRequire用于esmoudle模块化装在commonjs的模块
const require = createRequire(import.meta.url)

// fileURLToPath根据所给的url对象或者路径字符串，获取原始的文件路径（不会被url编码）
// dirname 获取当前文件路径的上级目录，不会做编码处理，所以此处先通过fileURLToPath获取原始文件路径
const __dirname = dirname(fileURLToPath(import.meta.url))

// process是node内置的全局对象，包含node进程相关信息和控制能力
// process.argv是获取执行node命令时的相关命令和参数，以空格分隔成数组
// argv0时指令的执行文件路径及node执行文件所在位置
// argv1是该对象获取时是在哪个文件上获取的，当初指语句所在文件
// argv2-N是则是跟在命令后的额外指令参数
// minimist是一个轻量级的命令行参数解析器可以将参数解析为键值存储到对象中，无值指令则会统一收录到键为_的数组中，
const args = minimist(process.argv.slice(2))

// 用于编译的项目包
const target = args._[0] || 'vue'
// 用于编译生成的文件模式，含义于dist里各种场景下使用的vue文件一致
const format = args.f || 'global'
// 是否生产环境
const prod = args.p || false

// 是否内联依赖，默认不开启，即将指定依赖文件设定为外部依赖进行引入
// 疑问：是否是区分手动更改依赖源码触发更新使用
const inlineDeps = args.i || args.inline
// 目标项目工程的package.json配置，因为是Monorepo项目会有多个项目差异，源码分析只考虑vue项目工程下
const pkg = require(`../packages/${target}/package.json`)

// 决定编译后文件的模块方式 iife立即执行及传统模块加载， cjs是CommonJs模块加载，esm是ESMoudle方式加载
// resolve output
const outputFormat = format.startsWith('global')
  ? 'iife'
  : format === 'cjs'
    ? 'cjs'
    : 'esm'

// 读取文件生成后缀判断
const postfix = format.endsWith('-runtime')
  ? `runtime.${format.replace(/-runtime$/, '')}`
  : format

// 构建输出文件的绝对路径
const outfile = resolve(
  __dirname,
  `../packages/${target}/dist/${
    target === 'vue-compat' ? `vue` : target
  }.${postfix}.${prod ? `prod.` : ``}js`,
)

// process.cwd为当前nodek进程的工作目录
// 根据工作目录，获取找输出路径outfile的相对路径
const relativeOutfile = relative(process.cwd(), outfile)

// resolve externals
// TODO this logic is largely duplicated from rollup.config.js
/** @type {string[]} */
let external = []
// TODO 此处为供rollup打包依赖的规则配置，后续研究
if (!inlineDeps) {
  // cjs & esm-bundler: external all deps
  if (format === 'cjs' || format.includes('esm-bundler')) {
    external = [
      ...external,
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
      // for @vue/compiler-sfc / server-renderer
      'path',
      'url',
      'stream',
    ]
  }

  if (target === 'compiler-sfc') {
    const consolidatePkgPath = require.resolve(
      '@vue/consolidate/package.json',
      {
        paths: [resolve(__dirname, `../packages/${target}/`)],
      },
    )
    const consolidateDeps = Object.keys(
      require(consolidatePkgPath).devDependencies,
    )
    external = [
      ...external,
      ...consolidateDeps,
      'fs',
      'vm',
      'crypto',
      'react-dom/server',
      'teacup/lib/express',
      'arc-templates/dist/es5',
      'then-pug',
      'then-jade',
    ]
  }
}

// TODO 以下全是ESBuild 相关配置
/** @type {Array<import('esbuild').Plugin>} */
const plugins = [
  {
    name: 'log-rebuild',
    setup(build) {
      build.onEnd(() => {
        console.log(`built: ${relativeOutfile}`)
      })
    },
  },
]

// 非浏览器环境执行加载兼容nodejs的polyfill插件
if (format !== 'cjs' && pkg.buildOptions?.enableNonBrowserBranches) {
  plugins.push(polyfillNode())
}

esbuild
  .context({
    entryPoints: [resolve(__dirname, `../packages/${target}/src/index.ts`)],
    outfile,
    bundle: true,
    external,
    sourcemap: true,
    format: outputFormat,
    globalName: pkg.buildOptions?.name,
    platform: format === 'cjs' ? 'node' : 'browser',
    plugins,
    define: {
      __COMMIT__: `"dev"`,
      __VERSION__: `"${pkg.version}"`,
      __DEV__: prod ? `false` : `true`,
      __TEST__: `false`,
      __BROWSER__: String(
        format !== 'cjs' && !pkg.buildOptions?.enableNonBrowserBranches,
      ),
      __GLOBAL__: String(format === 'global'),
      __ESM_BUNDLER__: String(format.includes('esm-bundler')),
      __ESM_BROWSER__: String(format.includes('esm-browser')),
      __NODE_JS__: String(format === 'cjs'),
      __SSR__: String(format === 'cjs' || format.includes('esm-bundler')),
      __COMPAT__: String(target === 'vue-compat'),
      __FEATURE_SUSPENSE__: `true`,
      __FEATURE_OPTIONS_API__: `true`,
      __FEATURE_PROD_DEVTOOLS__: `false`,
      __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__: `false`,
    },
  })
  .then(ctx => ctx.watch())
