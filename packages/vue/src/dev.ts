import { initCustomFormatter } from '@vue/runtime-dom'

export function initDev() {
  // esbuild全局变量 判断js运行环境为 true
  if (__BROWSER__) {
    /* istanbul ignore if */

    // esbuild全局变量 判断是否ESM打包 这里就提示一下当前是开发版本
    if (!__ESM_BUNDLER__) {
      console.info(
        `You are running a development build of Vue.\n` +
          `Make sure to use the production build (*.prod.js) when deploying for production.`,
      )
    }

    initCustomFormatter()
  }
}
