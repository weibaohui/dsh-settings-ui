import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const here = dirname(fileURLToPath(import.meta.url))
const require2 = createRequire(import.meta.url)
const host = require2('../src/index.js')
const { sniffImage, sanitizeSettingsPatch } = host.__internals

// ── sniffImage：魔数白名单 ───────────────────────────────────────────────

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)])

test('sniffImage: png/jpg/gif/webp 命中，junk/短串拒绝', () => {
  assert.deepEqual(sniffImage(PNG), { ext: 'png', type: 'image/png' })
  assert.deepEqual(sniffImage(JPEG), { ext: 'jpg', type: 'image/jpeg' })
  assert.deepEqual(sniffImage(GIF), { ext: 'gif', type: 'image/gif' })
  assert.deepEqual(sniffImage(WEBP), { ext: 'webp', type: 'image/webp' })
  assert.equal(sniffImage(Buffer.from('<html><script>')), null)
  assert.equal(sniffImage(Buffer.from('ab')), null)
  assert.equal(sniffImage(null), null)
})

test('sanitize: bgFile/bgRev 白名单通过', () => {
  assert.deepEqual(sanitizeSettingsPatch({ bgFile: 'bg.png', bgRev: 'abc123' }), { bgFile: 'bg.png', bgRev: 'abc123' })
  assert.deepEqual(sanitizeSettingsPatch({ bgFile: 42 }), {})
})

// ── 路由全链路（fake ctx + DSH_HOME 隔离）───────────────────────────────

function fakeRes() {
  const res = { statusCode: null, headers: null, body: null, chunks: [] }
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers }
  res.end = (b) => { if (b) res.chunks.push(b); res.body = Buffer.concat(res.chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))) }
  return res
}
function fakeRawReq(buf, url, method = 'POST') {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  process.nextTick(() => {
    if (buf && buf.length) req.emit('data', buf)
    req.emit('end')
  })
  return req
}

test('上传→落盘→status 携带 bgFile/bgRev→GET 服务字节与 content-type；换格式清旧文件；junk 400', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-settings-ui-bg-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const routes = []
    const ctx = {
      logger: { info() {}, warn() {} },
      effect: (fn) => fn(),
      settings: undefined, // 走 sanitize 回退路径
      webServer: { register: (r) => routes.push(r) },
    }
    host.apply(ctx, {})
    const route = routes[0]

    // 1) 上传 PNG
    let res = fakeRes()
    await route.handler(fakeRawReq(PNG, '/dsh-settings-ui/api/bg'), res)
    assert.equal(res.statusCode, 200)
    const first = JSON.parse(res.body)
    assert.equal(first.bgFile, 'bg.png')
    assert.ok(first.bgRev.length === 12)
    const stored = await readFile(join(home, 'dsh-settings-ui', 'bg.png'))
    assert.ok(stored.equals(PNG))

    // 2) status 带 bgFile/bgRev（回退 config 路径）
    res = fakeRes()
    await route.handler({ method: 'GET', url: '/dsh-settings-ui/api/status' }, res)
    const st = JSON.parse(res.body).settings
    assert.equal(st.bgFile, 'bg.png')
    assert.equal(st.bgRev, first.bgRev)

    // 3) GET 服务：字节一致 + content-type
    res = fakeRes()
    await route.handler({ method: 'GET', url: '/dsh-settings-ui/api/bg' }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-type'], 'image/png')
    assert.ok(res.body.equals(PNG))

    // 4) 换格式上传 JPEG：旧 bg.png 被清掉，设置切到 bg.jpg
    res = fakeRes()
    await route.handler(fakeRawReq(JPEG, '/dsh-settings-ui/api/bg'), res)
    const second = JSON.parse(res.body)
    assert.equal(second.bgFile, 'bg.jpg')
    await assert.rejects(readFile(join(home, 'dsh-settings-ui', 'bg.png')))

    // 5) 清除：bgFile='' → GET 404
    res = fakeRes()
    await route.handler(fakeRawReq(JSON.stringify({ bgFile: '', bgRev: '' }), '/dsh-settings-ui/api/settings', 'PUT'), res)
    assert.equal(res.statusCode, 200)
    res = fakeRes()
    await route.handler({ method: 'GET', url: '/dsh-settings-ui/api/bg' }, res)
    assert.equal(res.statusCode, 404)

    // 6) junk 上传 → 400
    res = fakeRes()
    await route.handler(fakeRawReq(Buffer.from('not an image at all'), '/dsh-settings-ui/api/bg'), res)
    assert.equal(res.statusCode, 400)

    // 7) 超上限 → 400
    res = fakeRes()
    await route.handler(fakeRawReq(Buffer.alloc(host.__internals.BG_MAX_BYTES + 1), '/dsh-settings-ui/api/bg'), res)
    assert.equal(res.statusCode, 400)
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    await rm(home, { recursive: true, force: true })
  }
})
