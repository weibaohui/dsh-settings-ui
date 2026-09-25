/**
 * Offline test suite for the host half: the connection trust fence
 * (Host/Origin + browser auth barrier) guards every route, the 0.1.7 settings
 * wiring persists PUTs via ctx.settings.update (memory fallback on failure),
 * and the one-time legacy settings.yaml.imported migration behaves.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../src/index.js')
const { __internals } = plugin

// 默认屏蔽真实宿主残留（本机 ~/.dsh/settings.yaml.imported 可能存在），
// 迁移用例里再显式注入固定的 legacy 文本，保证测试与环境无关。
__internals.__seedLegacyYaml(null)

/**
 * 0.1.7-style settings 服务桩：describe() 投影 volatile 值，update() 落到
 * store（可注入故障），document-updated 事件手动触发。
 */
function makeSettingsService({ failUpdate, initial } = {}) {
  const writes = []
  const store = { ...(initial || {}) }
  const listeners = []
  return {
    writes,
    listeners,
    store,
    describe: () => [{ ns: 'dsh-settings-ui', value: { ...store }, user: { ...store } }],
    update: async (ns, patch) => {
      if (ns !== 'dsh-settings-ui') throw new Error(`No configurable plugin entry "${ns}"`)
      if (failUpdate) throw new Error(failUpdate)
      writes.push({ ...patch })
      Object.assign(store, patch)
    },
    emitDocumentUpdated: (ns) => listeners.forEach((fn) => fn(ns)),
  }
}

function makeHarness({ rejection, settings } = {}) {
  const routes = []
  const warnings = []
  const infos = []
  const ctx = {
    logger: {
      warn: (m) => warnings.push(String(m)),
      info: (m) => infos.push(String(m)),
    },
    settings,
    connection: { requestRejection: () => rejection },
    effect: (factory) => factory(),
    on: (event, fn) => { settings && settings.listeners.push(fn) },
    webServer: { register: (route) => routes.push(route) },
  }
  plugin.apply(ctx, {})
  assert.equal(routes.length, 1, 'the API route must be registered')
  return { routes, warnings, infos }
}

const fakeReq = (method, url) => ({ method, url, headers: {} })
const fakeRes = () => {
  const res = { statusCode: null, body: null }
  res.writeHead = (status) => { res.statusCode = status }
  res.end = (payload) => { res.body = payload }
  return res
}
const call = async (route, method, url, body) => {
  const req = fakeReq(method, url)
  if (body !== undefined) {
    req.on = (event, fn) => {
      if (event === 'data') fn(Buffer.from(JSON.stringify(body)))
      if (event === 'end') fn()
    }
  } else {
    req.on = (event, fn) => { if (event === 'end') fn() }
  }
  const res = fakeRes()
  await route.handler(req, res)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

test('plugin injects the connection service for the trust fence', () => {
  assert.ok(plugin.inject.includes('connection'))
})

test('plugin exports Config (0.1.7 settings discovery); volatile fields asserted via stub schema', () => {
  // 本机装了宿主 vendored schemastery 时 Config 是真 schema；CI 上可能是 null。
  if (plugin.Config) assert.equal(typeof plugin.Config, 'function')
  // 无论环境如何，字段构造都必须走 .volatile()（0.1.7 只投影/写回 volatile 字段）
  const calls = []
  const chain = () => {
    const o = {}
    o.default = () => o
    o.volatile = () => { calls.push('volatile'); return o }
    o.min = () => o
    o.max = () => o
    return o
  }
  const stub = {
    object: (fields) => fields,
    union: () => chain(),
    number: () => chain(),
    string: () => chain(),
  }
  const fields = __internals.settingsSchema(stub)
  assert.equal(Object.keys(fields).length, 7)
  assert.equal(calls.length, 7, 'every field must be marked volatile')
  assert.equal(__internals.settingsSchema(null), null)
})

test('every route sits behind the connection trust fence', async () => {
  const { routes } = makeHarness({ rejection: 401 })
  const { status } = await call(routes[0], 'GET', '/dsh-settings-ui/api/status')
  assert.equal(status, 401, 'unauthenticated status read is refused')
})

test('allowed requests reach the status endpoint', async () => {
  const { routes } = makeHarness({ rejection: undefined })
  const { status } = await call(routes[0], 'GET', '/dsh-settings-ui/api/status')
  assert.equal(status, 200)
})

test('GET status reflects live values from the settings document (0.1.7 describe)', async () => {
  const settings = makeSettingsService({ initial: { size: 'full', opacity: 70 } })
  const { routes } = makeHarness({ settings })
  const { json } = await call(routes[0], 'GET', '/dsh-settings-ui/api/status')
  assert.equal(json.settings.size, 'full')
  assert.equal(json.settings.opacity, 70)
})

test('PUT persists through ctx.settings.update and returns the merged settings', async () => {
  const settings = makeSettingsService()
  const { routes } = makeHarness({ settings })
  const { status, json } = await call(routes[0], 'PUT', '/dsh-settings-ui/api/settings', { size: 'xlarge', opacity: 60 })
  assert.equal(status, 200)
  assert.equal(json.settings.size, 'xlarge')
  assert.equal(json.settings.opacity, 60)
  assert.deepEqual(settings.writes, [{ size: 'xlarge', opacity: 60 }], 'the sanitized patch must be persisted')
})

test('PUT clamps / rejects invalid fields before persisting', async () => {
  const settings = makeSettingsService()
  const { routes } = makeHarness({ settings })
  const { json } = await call(routes[0], 'PUT', '/dsh-settings-ui/api/settings', { size: 'giant', opacity: 5, bgMode: 'image' })
  assert.equal(json.settings.opacity, 30)
  assert.equal(json.settings.bgMode, 'default')
  assert.deepEqual(settings.writes, [{ opacity: 30, bgMode: 'default' }])
})

test('PUT survives a failing settings service via the in-memory fallback', async () => {
  const settings = makeSettingsService({ failUpdate: 'No configurable plugin entry' })
  const { routes, warnings } = makeHarness({ settings })
  const { status, json } = await call(routes[0], 'PUT', '/dsh-settings-ui/api/settings', { size: 'full' })
  assert.equal(status, 200)
  assert.equal(json.settings.size, 'full', 'the merge still applies for this run')
  assert.ok(warnings.some((w) => w.includes('仅本次运行生效')), 'the fallback is announced')
})

test('settings/document-updated refreshes the live projection', async () => {
  const settings = makeSettingsService()
  const { routes } = makeHarness({ settings })
  settings.store.size = 'full'
  settings.emitDocumentUpdated('dsh-settings-ui')
  const { json } = await call(routes[0], 'GET', '/dsh-settings-ui/api/status')
  assert.equal(json.settings.size, 'full')
})

// ── legacy settings.yaml.imported 迁移 ──────────────────────────────────

const legacyYaml = [
  '# dsh legacy settings',
  'ui-onboarding:',
  '  welcomeNoticeVersion: 2026-08-13.1',
  'settings-ui:',
  '  size: xlarge',
  '  customWidth: 1280',
  '  opacity: 70',
  '  bgMode: image',
  '  bgColor: "#e8e8e8"',
  '  bgFile: "bg.png"',
  '  bgColorDark: \'#1e2a38\'',
  'other-section:',
  '  key: value',
].join('\n')

test('parseLegacySettingsYaml: 只取 settings-ui 平铺节，类型归位', () => {
  const parsed = __internals.parseLegacySettingsYaml(legacyYaml)
  assert.deepEqual(parsed, {
    size: 'xlarge', customWidth: 1280, opacity: 70, bgMode: 'image',
    bgColor: '#e8e8e8', bgFile: 'bg.png', bgColorDark: '#1e2a38',
  })
  assert.equal(__internals.parseLegacySettingsYaml('no section here'), null)
  assert.equal(__internals.parseLegacySettingsYaml(''), null)
})

test('isPristine: 全默认（或缺席）为真，任一覆盖即假', () => {
  assert.equal(__internals.isPristine({}), true)
  assert.equal(__internals.isPristine({ size: 'default' }), true)
  assert.equal(__internals.isPristine({ size: 'full' }), false)
  assert.equal(__internals.isPristine({ opacity: 70 }), false)
})

test('migration: 全新状态下把旧值（消毒后）写回 settings 文档', async () => {
  __internals.__seedLegacyYaml(legacyYaml)
  try {
    const settings = makeSettingsService()
    const { infos } = makeHarness({ settings })
    await new Promise((r) => setTimeout(r, 10))
    // image 模式回落 default；bgColor/bgFile 等未知字段被剔除；显式默认值保留
    assert.deepEqual(settings.writes, [{ size: 'xlarge', customWidth: 1280, opacity: 70, bgMode: 'default', bgColorDark: '#1e2a38' }])
    assert.ok(infos.some((m) => m.includes('迁移')), 'the migration is announced')
  } finally {
    __internals.__seedLegacyYaml(null)
  }
})

test('migration: 残留文件缺失/全默认时不写入', async () => {
  __internals.__seedLegacyYaml(null)
  const settings = makeSettingsService()
  const { infos } = makeHarness({ settings })
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(settings.writes, [])
  assert.equal(infos.some((m) => m.includes('迁移')), false)
})

test('migration: 已有非默认值时不迁移（isPristine 短路）', async () => {
  __internals.__seedLegacyYaml(legacyYaml)
  try {
    const settings = makeSettingsService({ initial: { size: 'full' } })
    const { routes, infos } = makeHarness({ settings })
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual(settings.writes, [])
    assert.equal(infos.some((m) => m.includes('迁移')), false)
    const { json } = await call(routes[0], 'GET', '/dsh-settings-ui/api/status')
    assert.equal(json.settings.size, 'full')
  } finally {
    __internals.__seedLegacyYaml(null)
  }
})
