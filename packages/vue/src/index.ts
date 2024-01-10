// This entry is the "full-build" that includes both the runtime
// and the compiler, and supports on-the-fly compilation of the template option.
import {
  type CompilerError,
  type CompilerOptions,
  compile,
} from '@vue/compiler-dom'
import * as runtimeDom from '@vue/runtime-dom'
import {
  type RenderFunction,
  registerRuntimeCompiler,
  warn,
} from '@vue/runtime-dom'
import {
  EMPTY_OBJ,
  NOOP,
  extend,
  generateCodeFrame,
  isString,
} from '@vue/shared'
import type { InternalRenderFunction } from 'packages/runtime-core/src/component'
import { initDev } from './dev'

// esbuild 定义的全局变量 dev模式下为false
if (__DEV__) {
  initDev()
}

// WeakMap 是一个对象为key，的特殊map可以很方便的优化内存，当单一key被移除时，value会变成弱引用
const compileCache = new WeakMap<
  CompilerOptions,
  Record<string, RenderFunction>
>()

/**
 * 以options为key 获取weakMap中key对应的值，不存在则创建一个空对象  将模板字符串做options中的key，value为渲染函数
 * @param options 编译缓存map的key
 * @returns
 */
function getCache(options?: CompilerOptions) {
  let c = compileCache.get(options ?? EMPTY_OBJ)
  if (!c) {
    c = Object.create(null) as Record<string, RenderFunction>
    compileCache.set(options ?? EMPTY_OBJ, c)
  }
  return c
}

/**
 * 利用compileCache缓存缓存模板字符串，首次编译将编译后的render函数存入compileCache，下次编译直接从缓存获取render函数
 * @param template dom模板内容 or dom实例
 * @param options 编译参数
 * @returns
 */
function compileToFunction(
  template: string | HTMLElement,
  options?: CompilerOptions,
): RenderFunction {
  // 判断是模板字符串还是dom实例，如果是dom实例则获取dom内容字符串
  if (!isString(template)) {
    if (template.nodeType) {
      template = template.innerHTML
    } else {
      __DEV__ && warn(`invalid template option: `, template)
      return NOOP
    }
  }
  // 将模板字符串作为key去缓存对象里获取缓存，如果存在则直接返回
  const key = template
  const cache = getCache(options)
  const cached = cache[key]
  if (cached) {
    return cached
  }

  // todo 如果模板字符串是#开头则认为是id选择器，去获取对应dom实例，并将template更新为该实例的dom字符串 不知道函数位置不提前到缓存获取之前，而是放在之后
  if (template[0] === '#') {
    const el = document.querySelector(template)
    if (__DEV__ && !el) {
      warn(`Template element not found or is empty: ${template}`)
    }
    // __UNSAFE__
    // Reason: potential execution of JS expressions in in-DOM template.
    // The user must make sure the in-DOM template is trusted. If it's rendered
    // by the server, the template should not contain any user data.
    template = el ? el.innerHTML : ``
  }

  // extend 等效 Object.assign
  const opts = extend(
    {
      hoistStatic: true,
      onError: __DEV__ ? onError : undefined,
      onWarn: __DEV__ ? e => onError(e, true) : NOOP,
    } as CompilerOptions,
    options,
  )

  // opts.isCustomElement用于判断vdom内容是否是自定义标签, customElements 是window原型的全局变量，用于注册自定义标签，截至20240109：仅chrome和edge支持
  if (!opts.isCustomElement && typeof customElements !== 'undefined') {
    opts.isCustomElement = tag => !!customElements.get(tag)
  }

  // 利用编译器结合 模板字符串和编译参数，获取对应模板字符串可以进行内容渲染的js原生代码（字符串形式需要eval或者Function进行处理才可执行）
  const { code } = compile(template, opts)

  // 编译错误事件 用以上面opt合并到编译参数中 （强迫症看着有点难受，引用在声明的前面，虽然不影响功能）
  function onError(err: CompilerError, asWarning = false) {
    const message = asWarning
      ? err.message
      : `Template compilation error: ${err.message}`
    // todo 以下是告警信息的组装，方法逻辑毕竟复杂，不理解设计情况下不是很好分析，后续考虑
    const codeFrame =
      err.loc &&
      generateCodeFrame(
        template as string,
        err.loc.start.offset,
        err.loc.end.offset,
      )
    warn(codeFrame ? `${message}\n${codeFrame}` : message)
  }

  // The wildcard import results in a huge object with every export
  // with keys that cannot be mangled, and can be quite heavy size-wise.
  // In the global build we know `Vue` is available globally so we can avoid
  // the wildcard object.
  // todo 生成render函数并存入缓存，注释没看明白什么意思
  const render = (
    __GLOBAL__ ? new Function(code)() : new Function('Vue', code)(runtimeDom)
  ) as RenderFunction
  // 如注释描述
  // mark the function as runtime compiled
  ;(render as InternalRenderFunction)._rc = true

  return (cache[key] = render)
}

// 注册运行时编译器
registerRuntimeCompiler(compileToFunction)

export * from '@vue/runtime-dom'
export { compileToFunction as compile }
