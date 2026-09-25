'use strict'

/**
 * dsh-plugin-settings-ui — host half.
 *
 * Persists the tweak settings (settings namespace `dsh-settings-ui`) and serves
 * them to the browser half over a tiny webServer route (GET status / PUT
 * settings). The actual CSS injection lives entirely in the client half — the
 * host never touches the frontend.
 *
 * dsh 0.1.7 settings 模型（对齐 dsh-webdav-server / dsh-git-server 的适配）：
 * settings 服务不再支持 ctx.settings.register，改为发现模块顶层导出的
 * Config schema（字段标 .volatile() 才可被设置 UI 投影与在线写回），值持久化
 * 在 profile patch 里（重启不丢）。写入走 ctx.settings.update(ns, patch)，
 * 变更经 'settings/document-updated' 事件回流。settings 服务缺席时退回
 * 进程内兜底（本次运行有效，重启还原）。
 */

const { join } = require('node:path')
const { homedir, } = require('node:os')
const { readFileSync } = require('node:fs')

const NS = 'dsh-settings-ui'

const DEFAULTS = {
  size: 'default',        // default | large | xlarge | full | custom
  customWidth: 1280,
  customHeight: 960,
  opacity: 100,           // 30..100
  bgMode: 'default',      // default | color
  bgColorLight: '#eef1f5',  // 亮色主题下的纯色背景
  bgColorDark: '#1e2a38',   // 暗色主题下的纯色背景
}

// settings 服务要求 schemastery schema（宿主 vendored 副本优先，同 dsh-webdav-server）。
// 必须在模块顶层同步构建并导出 Config：0.1.7 loader 通过
// entry.fiber.runtime.Config 自动发现 schema，apply 里再建就晚了。
function loadSchemastery() {
  const errors = []
  const { createRequire } = require('node:module')
  for (const prefix of [process.env.DSH_GLOBAL_PREFIX, homedir() + '/.local'].filter(Boolean)) {
    const hostCopy = join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.cjs')
    try { return createRequire(hostCopy)(hostCopy) } catch (e) { errors.push(`host: ${String(e && e.message || e).slice(0, 100)}`) }
  }
  try { return require('@deepseek-ai/schemastery') } catch (e) { errors.push(`pkg: ${String(e && e.code || e)}`) }
  schemaRequireError = errors.join(' | ')
  return null
}
let schemaRequireError = null
const Schema = loadSchemastery()

/** volatile 字段：0.1.7 settings 服务只投影/写回这些字段。 */
function settingsSchema(S) {
  if (!S || typeof S.object !== 'function') return null
  return S.object({
    size: S.union(['default', 'large', 'xlarge', 'full', 'custom']).default(DEFAULTS.size).volatile(),
    customWidth: S.number().min(480).default(DEFAULTS.customWidth).volatile(),
    customHeight: S.number().min(360).default(DEFAULTS.customHeight).volatile(),
    opacity: S.number().min(30).max(100).default(DEFAULTS.opacity).volatile(),
    bgMode: S.union(['default', 'color']).default(DEFAULTS.bgMode).volatile(),
    bgColorLight: S.string().default(DEFAULTS.bgColorLight).volatile(),
    bgColorDark: S.string().default(DEFAULTS.bgColorDark).volatile(),
  })
}
const Config = settingsSchema(Schema)

/** 老版本残留的 bgMode='image' 统一回落到主题默认（图片背景已下线）。 */
function normalizeBgMode(mode) {
  return mode === 'color' ? 'color' : 'default'
}

/** settings 写回前的回退校验（对齐 dsh-webdav-server 的 sanitizePatch）。 */
function sanitizeSettingsPatch(patch) {
  if (patch === null || typeof patch !== 'object') return {}
  const out = {}
  if (typeof patch.size === 'string' && ['default', 'large', 'xlarge', 'full', 'custom'].includes(patch.size)) out.size = patch.size
  const num = (key, min) => {
    const v = patch[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= min) out[key] = v
  }
  num('customWidth', 480)
  num('customHeight', 360)
  if (typeof patch.opacity === 'number' && Number.isFinite(patch.opacity)) {
    out.opacity = Math.min(100, Math.max(30, Math.round(patch.opacity)))
  }
  if (typeof patch.bgMode === 'string' && ['default', 'color', 'image'].includes(patch.bgMode)) out.bgMode = normalizeBgMode(patch.bgMode)
  if (typeof patch.bgColorLight === 'string') out.bgColorLight = patch.bgColorLight
  if (typeof patch.bgColorDark === 'string') out.bgColorDark = patch.bgColorDark
  return out
}

/** 所有已知字段都还是默认值（迁移旧值只在这种“全新”状态下进行）。 */
function isPristine(values) {
  const v = values || {}
  return Object.keys(DEFAULTS).every((key) => v[key] === undefined || v[key] === DEFAULTS[key])
}

/**
 * 从 dsh 0.1.7 迁移残留的 settings.yaml.imported 里读出 settings-ui 节。
 * 只需支持平铺的 key: value（字符串/数字/布尔），解析失败返回 null。
 */
function parseLegacySettingsYaml(text) {
  try {
    const lines = String(text || '').split(/\r?\n/)
    const start = lines.findIndex((line) => /^settings-ui:/.test(line))
    if (start === -1) return null
    const out = {}
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      if (!/^\s/.test(line)) break // 下一节开始
      const m = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/)
      if (!m) continue
      let raw = m[2].trim()
      if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1)
      else if (raw === 'true') raw = true
      else if (raw === 'false') raw = false
      else if (/^-?\d+(\.\d+)?$/.test(raw)) raw = Number(raw)
      out[m[1]] = raw
    }
    return out
  } catch {
    return null
  }
}


// 0.1.7 宿主 resolveConfig 会把 apply-config 里的 volatile 字段物化成 {}（实测）：
// {} 会盖掉 DEFAULTS，导致 describe 就绪前/降级路径下拿到毒化值。这里只保留
// 类型与默认值一致的标量/数组；真实持久化值走 describe 投影（liveSettings）。
function saneConfigValues(config, defaults) {
  const out = {}
  for (const key of Object.keys(defaults)) {
    const v = (config || {})[key]
    if (v === undefined || v === null) continue
    if (Array.isArray(defaults[key])) { if (Array.isArray(v)) out[key] = v; continue }
    if (typeof v === typeof defaults[key]) out[key] = v
  }
  return out
}

function legacySettingsPath() {
  const home = process.env.DSH_HOME ? join(process.env.DSH_HOME) : homedir() + '/.dsh'
  return join(home, 'settings.yaml.imported')
}

// 测试缝隙：预注入 legacy yaml 文本，单测不依赖本机宿主残留文件。
// undefined = 未注入（读真实文件）；null = 明确无文件；字符串 = 注入内容。
let __legacyYamlOverride
function __seedLegacyYaml(text) { __legacyYamlOverride = text === undefined ? undefined : text === null ? null : String(text) }
function readLegacyYaml() {
  if (__legacyYamlOverride !== undefined) return __legacyYamlOverride
  try { return readFileSync(legacySettingsPath(), 'utf8') } catch { return null }
}

module.exports = {
  name: NS,
  inject: ['settings', 'webServer', 'connection'],
  Config,
  __internals: { DEFAULTS, NS, settingsSchema, sanitizeSettingsPatch, normalizeBgMode, isPristine, parseLegacySettingsYaml, legacySettingsPath, __seedLegacyYaml },

  apply(ctx, config = {}) {
    // 宿主可能过滤插件 logger 输出；console.error 走 stderr 保底可见（launchd 下进 err.log，同 dsh-webdav-server）
    const hostLogger = ctx.logger && typeof ctx.logger.warn === 'function' ? ctx.logger : null
    const logger = {
      info(m) { try { hostLogger && hostLogger.info && hostLogger.info(m) } catch {} console.error(`dsh-settings-ui: ${m}`) },
      warn(m) { try { hostLogger && hostLogger.warn && hostLogger.warn(m) } catch {} console.error(`dsh-settings-ui: ${m}`) },
    }

    const base = { ...DEFAULTS, ...saneConfigValues(config, DEFAULTS) }
    let liveSettings = {} // settings 文档里的实时 volatile 值（事件驱动刷新）
    let memoryPatch = {} // settings 写回缺席/失败时的进程内兜底

    // 0.1.7：读取本命名空间在 settings 文档里的投影（describe 的 volatile 字段）。
    // user 字段是 profile override——为空表示这个 profile 从未写回过。
    function readDescriptor() {
      try {
        if (!ctx.settings || typeof ctx.settings.describe !== 'function') return null
        return ctx.settings.describe().find((x) => x.ns === NS) || null
      } catch {
        return null
      }
    }
    function readLiveSettings() {
      const d = readDescriptor()
      return d && d.value && typeof d.value === 'object' ? d.value : {}
    }

    const effective = () => {
      const v = { ...base, ...liveSettings, ...memoryPatch }
      // 老版本残留的 image 模式回落到主题默认（图片背景已下线）
      v.bgMode = normalizeBgMode(v.bgMode)
      return v
    }

    /** 持久化写回（0.1.7 settings.update）；失败退回进程内兜底并告警。 */
    async function persist(patch) {
      memoryPatch = { ...memoryPatch, ...patch }
      if (ctx.settings && typeof ctx.settings.update === 'function') {
        try {
          await ctx.settings.update(NS, patch)
          return true
        } catch (e) {
          logger.warn(`settings update 失败（仅本次运行生效）: ${e && e.message}`)
        }
      }
      return false
    }

    /**
     * 一次性迁移：dsh 0.1.7 把全局 settings.yaml 改名为 settings.yaml.imported，
     * settings-ui 节因插件当时尚未导出 Config 而没能迁进 profile。仅在“本
     * profile 从未写回过”（settings 文档 user 段为空）且当前值仍是全新默认时
     * 把旧值搬回 settings 文档；此后值落在 profile patch 里，本函数自然短路。
     * 之后用户“恢复默认”会留下显式的默认 override，同样不会触发迁移复活。
     *
     * apply 时 settings 条目可能尚未注册（loader 未就绪），update 会暂时失败，
     * 因此失败后间隔重试几次；成功或判定无需迁移即停止。
     */
    let migrationSettled = false
    async function migrateLegacyValues(attempt = 0) {
      if (migrationSettled) return
      try {
        const descriptor = readDescriptor()
        if (descriptor && descriptor.user && typeof descriptor.user === 'object' && Object.keys(descriptor.user).length > 0) {
          migrationSettled = true // 本 profile 已有自己的设置，绝不覆盖
          return
        }
        if (!isPristine({ ...base, ...liveSettings })) { migrationSettled = true; return }
        const section = parseLegacySettingsYaml(readLegacyYaml())
        if (!section) { migrationSettled = true; return }
        const values = sanitizeSettingsPatch(section)
        if (Object.keys(values).length === 0 || Object.keys(values).every((key) => values[key] === DEFAULTS[key])) {
          migrationSettled = true
          return
        }
        if (await persist(values)) {
          migrationSettled = true
          liveSettings = readLiveSettings()
          logger.info('已从 settings.yaml.imported 迁移旧设置到 profile')
          return
        }
      } catch { /* 迁移失败不影响主流程 */ }
      if (attempt < 15) setTimeout(() => { migrateLegacyValues(attempt + 1) }, 2000).unref?.()
      else logger.warn('settings.yaml.imported 旧设置迁移未完成（settings 服务持续不可用）')
    }

    const sendJson = (res, status, payload) => {
      try {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(payload))
      } catch { /* 客户端早断（如超大 body destroy 后）：响应写不回去就算了 */ }
    }
    const readJsonBody = (req) => new Promise((fulfil, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 64 * 1024) { reject(new Error('request body too large')); req.destroy(); return }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const bufs = chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))
        try { fulfil(bufs.length === 0 ? {} : JSON.parse(Buffer.concat(bufs).toString('utf8'))) }
        catch (error) { reject(new Error(`invalid JSON body: ${error && error.message}`)) }
      })
      req.on('error', reject)
    })

    liveSettings = readLiveSettings()
    migrateLegacyValues()

    // 设置文档变更（含 dsh 自动生成的设置页与本插件的写回）刷新实时值
    try {
      if (ctx.on && typeof ctx.on === 'function') {
        ctx.effect(() => {
          const off = ctx.on('settings/document-updated', (ns) => {
            if (ns !== NS) return
            liveSettings = readLiveSettings()
          })
          return () => { try { off() } catch {} }
        }, 'dsh-settings-ui: settings watch')
      }
    } catch { /* 事件订阅不可用：写回后靠 memoryPatch 维持本次运行 */ }

    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-settings-ui/api',
      handler: async (req, res) => {
          // 与其它 host 路由一致的信任栅栏：connection 服务的 Host/Origin 检查
          // 加浏览器认证，防止本机任意网页跨站调用。
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end()
            return
          }
        try {
          const url = new URL(req.url || '/', 'http://dsh.local')
          const apiPath = url.pathname.replace(/\/+$/, '')
          if (req.method === 'GET' && apiPath.endsWith('/dsh-settings-ui/api/status')) {
            sendJson(res, 200, { settings: effective() })
            return
          }
          if (req.method === 'PUT' && apiPath.endsWith('/dsh-settings-ui/api/settings')) {
            const body = await readJsonBody(req)
            if (body === null || typeof body !== 'object') { sendJson(res, 400, { error: 'body must be an object' }); return }
            const patch = sanitizeSettingsPatch(body)
            await persist(patch)
            sendJson(res, 200, { ok: true, settings: effective() })
            return
          }
          sendJson(res, 404, { error: 'not found' })
        } catch (error) { sendJson(res, 400, { error: String(error && error.message || error) }) }
      },
    }), 'dsh-settings-ui: client api route')
  },
}
