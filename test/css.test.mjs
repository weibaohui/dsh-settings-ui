import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const require2 = createRequire(import.meta.url)

// ── client buildCss（vm 装载 bundle，React 走 shim）─────────────────────

const src = readFileSync(join(here, '..', 'client', 'bundle.js'), 'utf8')
function loadClient() {
  let loaded
  const sandbox = {
    window: { __ModuleLoader__: { load: (o) => { loaded = o } } },
    navigator: { language: 'zh' },
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  const fakeRequire = (name) => { throw new Error('no platform module: ' + name) }
  return loaded.factory(fakeRequire)
}
const client = loadClient()
const { buildCss, DEFAULTS, PANEL_SCOPED } = client.__internals

test('buildCss: 全默认输出空串（宿主样式零覆盖）', () => {
  assert.equal(buildCss({ ...DEFAULTS }), '')
  assert.equal(buildCss(undefined), '')
})

test('buildCss: 任意覆盖都以高特异性选择器开头', () => {
  assert.match(buildCss({ ...DEFAULTS, size: 'large' }), /^\.VOzbGW_overlay \.VOzbGW_panel\{/)
  assert.equal(PANEL_SCOPED, '.VOzbGW_overlay .VOzbGW_panel')
})

test('buildCss: 预置尺寸 / 全屏 / 自定义（含最小值钳位与小屏收缩）', () => {
  const large = buildCss({ ...DEFAULTS, size: 'large' })
  assert.match(large, /width:1080px/)
  assert.match(large, /height:min\(780px, calc\(100vh - 48px\)\)/)
  const full = buildCss({ ...DEFAULTS, size: 'full' })
  assert.match(full, /width:100vw/)
  assert.match(full, /max-width:none/)
  assert.match(full, /border-radius:0/)
  const tiny = buildCss({ ...DEFAULTS, size: 'custom', customWidth: 100, customHeight: 1 })
  assert.match(tiny, /width:min\(480px, calc\(100vw - 48px\)\)/)
  assert.match(tiny, /height:min\(360px, calc\(100vh - 48px\)\)/)
  const custom = buildCss({ ...DEFAULTS, size: 'custom', customWidth: 1440, customHeight: 900 })
  assert.match(custom, /width:min\(1440px, calc\(100vw - 48px\)\)/)
})

test('buildCss: 不透明度经 color-mix 生效并钳位 30–100', () => {
  assert.match(buildCss({ ...DEFAULTS, opacity: 60 }), /color-mix\(in srgb, var\(--dsw-alias-bg-layer-2\) 60%, transparent\)/)
  const clamped = buildCss({ ...DEFAULTS, opacity: 5 })
  assert.match(clamped, / 30%, transparent/)
  assert.equal(buildCss({ ...DEFAULTS, opacity: 100 }), '')
})

test('buildCss: 背景=纯色/图片（URL 引号转义；亮暗各取各色；颜色参与透明度混合）', () => {
  const state = { ...DEFAULTS, bgMode: 'color', bgColorLight: '#f5f5f5', bgColorDark: '#101820' }
  assert.match(buildCss(state, false), /background-color:#f5f5f5/)
  assert.match(buildCss(state, true), /background-color:#101820/)
  // 空串取值回退主题 token（跟随主题）
  assert.match(buildCss({ ...DEFAULTS, bgMode: 'color', bgColorDark: '' }, true), /background-color:var\(--dsw-alias-bg-layer-2\)/)
  assert.match(buildCss({ ...DEFAULTS, bgMode: 'color', bgColorDark: '#112233', opacity: 50 }, true),
    /color-mix\(in srgb, #112233 50%, transparent\)/)
  const img = buildCss({ ...DEFAULTS, bgMode: 'image', bgUrl: 'https://x/y".png' })
  assert.match(img, /background-image:url\("https:\/\/x\/y%22\.png"\)/)
  assert.match(img, /background-size:cover/)
  assert.match(img, /background-position:center/)
})

// ── host sanitizeSettingsPatch ──────────────────────────────────────────

const host = require2('../src/index.js')
const { sanitizeSettingsPatch } = host.__internals

test('sanitize: 白名单字段通过，非法 size/bgMode/低 opacity 被拒或钳位', () => {
  assert.deepEqual(sanitizeSettingsPatch({ size: 'full', opacity: 60, bgMode: 'color', bgColorLight: '#eee', bgColorDark: '#111', bgUrl: ' x ', customWidth: 1000 }),
    { size: 'full', opacity: 60, bgMode: 'color', bgColorLight: '#eee', bgColorDark: '#111', bgUrl: ' x ', customWidth: 1000 })
  assert.deepEqual(sanitizeSettingsPatch({ size: 'giant' }), {})
  assert.deepEqual(sanitizeSettingsPatch({ bgMode: 'hologram' }), {})
  assert.deepEqual(sanitizeSettingsPatch({ opacity: 5 }).opacity, 30)
  assert.deepEqual(sanitizeSettingsPatch({ opacity: 500 }).opacity, 100)
  assert.deepEqual(sanitizeSettingsPatch({ customWidth: 100 }), {})
  assert.deepEqual(sanitizeSettingsPatch(null), {})
  assert.deepEqual(sanitizeSettingsPatch('x'), {})
})
