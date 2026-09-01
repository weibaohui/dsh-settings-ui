'use strict'

/**
 * dsh-plugin-settings-ui — host half.
 *
 * Persists the tweak settings (settings scope `settings-ui`) and serves them
 * to the browser half over a tiny webServer route (GET status / PUT settings).
 * The actual CSS injection lives entirely in the client half — the host never
 * touches the frontend.
 */

const { createHash, randomUUID } = require('node:crypto')
const fsP = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { homedir } = require('node:os')
// settings 服务要求 schemastery schema（宿主 vendored 副本优先，同 hermes-loop）
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
let Schema = loadSchemastery()

const DEFAULTS = {
  size: 'default',        // default | large | xlarge | full | custom
  customWidth: 1280,
  customHeight: 960,
  opacity: 100,           // 30..100
  bgMode: 'default',      // default | color | image
  bgColorLight: '#eef1f5',  // 亮色主题下的纯色背景
  bgColorDark: '#1e2a38',   // 暗色主题下的纯色背景
  bgFile: '',               // 已上传背景图（bgDir 下的文件名，''=无）
  bgRev: '',                // 内容哈希前 12 位（缓存失效用）
  bgUrl: '',
}

function settingsSchema() {
  if (!Schema) return null
  return Schema.object({
    size: Schema.union(['default', 'large', 'xlarge', 'full', 'custom']).default('default'),
    customWidth: Schema.number().min(480).default(1280),
    customHeight: Schema.number().min(360).default(960),
    opacity: Schema.number().min(30).max(100).default(100),
    bgMode: Schema.union(['default', 'color', 'image']).default('default'),
    bgColorLight: Schema.string().default('#eef1f5'),
    bgColorDark: Schema.string().default('#1e2a38'),
    bgFile: Schema.string().default(''),
    bgRev: Schema.string().default(''),
    bgUrl: Schema.string().default(''),
  })
}

/** settings 服务缺席时的回退校验（对齐 hermes-loop 的 sanitizeSettingsPatch）。 */
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
  if (typeof patch.bgMode === 'string' && ['default', 'color', 'image'].includes(patch.bgMode)) out.bgMode = patch.bgMode
  if (typeof patch.bgColorLight === 'string') out.bgColorLight = patch.bgColorLight
  if (typeof patch.bgColorDark === 'string') out.bgColorDark = patch.bgColorDark
  if (typeof patch.bgFile === 'string') out.bgFile = patch.bgFile
  if (typeof patch.bgRev === 'string') out.bgRev = patch.bgRev
  if (typeof patch.bgUrl === 'string') out.bgUrl = patch.bgUrl
  return out
}

// ── 背景图片上传（v0.2）─────────────────────────────────────────────────
// 只接受上传白名单进插件存储目录，绝不做任意本地路径读取——webserver 绑
// 0.0.0.0 时任意路径服务 = LFI 漏洞。魔数嗅探定类型，不用扩展名/声明头。
const BG_MAX_BYTES = 8 * 1024 * 1024
const BG_NAMES = ['bg.png', 'bg.jpg', 'bg.gif', 'bg.webp']

function dshHome() {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
}
function bgDir() {
  return join(dshHome(), 'dsh-settings-ui')
}

/** 魔数嗅探图片类型；非白名单格式返回 null。 */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', type: 'image/png' }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' }
  const head = buf.slice(0, 12)
  if (head.toString('latin1').startsWith('GIF8')) return { ext: 'gif', type: 'image/gif' }
  if (head.toString('latin1').startsWith('RIFF') && head.toString('latin1').slice(8) === 'WEBP') return { ext: 'webp', type: 'image/webp' }
  return null
}

/** temp file + rename in the same directory → readers never see a half file. */
async function atomicWrite(targetFile, content) {
  await fsP.mkdir(join(targetFile, '..'), { recursive: true })
  const temp = join(join(targetFile, '..'), `.${randomUUID()}.tmp`)
  await fsP.writeFile(temp, content)
  await fsP.rename(temp, targetFile)
}

const readRawBody = (req, cap) => new Promise((fulfil, reject) => {
  let size = 0
  const chunks = []
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > cap) { reject(new Error(`image exceeds ${cap} bytes`)); if (typeof req.destroy === 'function') req.destroy(); return }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  })
  req.on('end', () => fulfil(Buffer.concat(chunks)))
  req.on('error', reject)
})

module.exports = {
  name: 'dsh-settings-ui',
  inject: ['settings', 'webServer'],
  __internals: { DEFAULTS, settingsSchema, sanitizeSettingsPatch, sniffImage, bgDir, BG_MAX_BYTES },

  apply(ctx, config = {}) {
    let settingsScope = null
    const schema = settingsSchema()
    if (schema && ctx.settings && typeof ctx.settings.register === 'function') {
      try {
        settingsScope = ctx.settings.register('settings-ui', schema, { base: { ...DEFAULTS, ...config } })
      } catch (e) {
        ctx.logger.warn(`dsh-settings-ui: settings register: ${e && e.message}`)
      }
    }
    const effective = () => {
      if (settingsScope && typeof settingsScope.get === 'function') {
        const v = settingsScope.get()
        if (v && typeof v === 'object') return { ...DEFAULTS, ...config, ...v }
      }
      return { ...DEFAULTS, ...config }
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

    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-settings-ui/api',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://dsh.local')
          const apiPath = url.pathname.replace(/\/+$/, '')
          if (req.method === 'GET' && apiPath.endsWith('/dsh-settings-ui/api/status')) {
            sendJson(res, 200, { settings: effective() })
            return
          }
          // 上传背景图：魔数嗅探 → 原子写 → 设置只存文件名+哈希（配置不膨胀）
          if (req.method === 'POST' && apiPath.endsWith('/dsh-settings-ui/api/bg')) {
            const body = await readRawBody(req, BG_MAX_BYTES)
            const img = sniffImage(body)
            if (img === null) { sendJson(res, 400, { error: 'unsupported image (png/jpg/gif/webp only)' }); return }
            const name = 'bg.' + img.ext
            await fsP.mkdir(bgDir(), { recursive: true })
            for (const old of BG_NAMES) {
              if (old !== name) await fsP.rm(join(bgDir(), old), { force: true }).catch(() => {})
            }
            await atomicWrite(join(bgDir(), name), body)
            const rev = createHash('sha256').update(body).digest('hex').slice(0, 12)
            const patch = { bgFile: name, bgRev: rev }
            if (settingsScope && typeof settingsScope.update === 'function') await settingsScope.update(patch)
            else Object.assign(config, sanitizeSettingsPatch(patch))
            sendJson(res, 200, { ok: true, bgFile: name, bgRev: rev, settings: effective() })
            return
          }
          // 服务已上传的背景图（同源，供 CSS background-image 引用）
          if (req.method === 'GET' && apiPath.endsWith('/dsh-settings-ui/api/bg')) {
            const s = effective()
            if (s.bgFile === '') { sendJson(res, 404, { error: 'no background uploaded' }); return }
            let buf
            try { buf = await fsP.readFile(join(bgDir(), s.bgFile)) }
            catch { sendJson(res, 404, { error: 'background file missing' }); return }
            const img = sniffImage(buf) || { type: 'application/octet-stream' }
            res.writeHead(200, { 'content-type': img.type, 'cache-control': 'no-cache' })
            res.end(buf)
            return
          }
          if (req.method === 'PUT' && apiPath.endsWith('/dsh-settings-ui/api/settings')) {
            const body = await readJsonBody(req)
            if (body === null || typeof body !== 'object') { sendJson(res, 400, { error: 'body must be an object' }); return }
            if (settingsScope && typeof settingsScope.update === 'function') await settingsScope.update(body)
            else Object.assign(config, sanitizeSettingsPatch(body))
            sendJson(res, 200, { ok: true, settings: effective() })
            return
          }
          sendJson(res, 404, { error: 'not found' })
        } catch (error) { sendJson(res, 400, { error: String(error && error.message || error) }) }
      },
    }), 'dsh-settings-ui: client api route')
  },
}
