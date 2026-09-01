/* dsh-plugin-settings-ui — browser half.
 *
 * Single surface: a section inside the NATIVE dsh settings window
 * (`settings.section` slot, same pattern as dsh-continue). Adjusts the
 * settings window itself: size (presets / fullscreen / custom W×H), background
 * translucency, background color or image. Values live in the host settings
 * scope (GET/PUT /dsh-settings-ui/api/*); the client applies them as an
 * injected <style> at boot and after every save — changes take effect while
 * the settings window is open.
 *
 * Target CSS (dsh 0.1.1-rc.2): the panel is `.VOzbGW_panel` inside
 * `.VOzbGW_overlay` (dsh-client-ui-settings-general). The hash may change
 * between dsh builds — when a dsh upgrade silently reverts the tweak, re-check
 * that file. Overrides are emitted at higher specificity so they win regardless
 * of <style> insertion order.
 */
window.__ModuleLoader__.load({
  id: '@weibaohui/dsh-settings-ui',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // React with a minimal Node shim so the source stays loadable for tests.
    var __React = null
    try { __React = require('react') } catch {}
    if (!__React || typeof __React.createElement !== 'function') {
      __React = {
        createElement(type, props) { for (var l = arguments.length, kids = [], i = 2; i < l; i++) kids.push(arguments[i]); return { type, props: props || {}, kids } },
        useState(init) { var v = [typeof init === 'function' ? init() : init]; return [v[0], function (x) { v[0] = typeof x === 'function' ? x(v[0]) : x }] },
        useEffect() {},
      }
    }
    var h = __React.createElement
    var useState = __React.useState
    var useEffect = __React.useEffect

    var NS = 'dsh-settings-ui'
    var CLIENT_NAME = '@weibaohui/dsh-settings-ui'
    var API = '/dsh-settings-ui/api'
    var STYLE_ID = 'dsh-settings-ui-style'
    var PANEL_SCOPED = '.VOzbGW_overlay .VOzbGW_panel'
    var DEFAULTS = { size: 'default', customWidth: 1280, customHeight: 960, opacity: 100, bgMode: 'default', bgColorLight: '#eef1f5', bgColorDark: '#1e2a38', bgUrl: '' }
    var PRESETS = { large: { w: 1080, h: 780 }, xlarge: { w: 1280, h: 960 } }

    var ZH = {
      title: '设置界面',
      size: '窗口大小',
      'size.default': '默认（800×800）',
      'size.large': '大（1080×780）',
      'size.xlarge': '特大（1280×960）',
      'size.full': '全屏',
      'size.custom': '自定义',
      customWH: '宽 × 高（px）',
      opacity: '背景不透明度',
      bg: '背景',
      'bg.default': '主题默认',
      'bg.color': '纯色',
      bgColorLight: '浅色主题',
      bgColorDark: '暗色主题',
      'bg.image': '图片',
      bgUrl: '图片地址',
      reset: '恢复默认',
      saved: '已保存',
      hint: '改动即时生效；纯色按亮/暗主题各存一色，切换自动跟随；随 dsh profile 保存',
      loadFailed: '设置加载失败',
    }
    var EN = {
      title: 'Settings window',
      size: 'Window size',
      'size.default': 'Default (800×800)',
      'size.large': 'Large (1080×780)',
      'size.xlarge': 'X-Large (1280×960)',
      'size.full': 'Fullscreen',
      'size.custom': 'Custom',
      customWH: 'W × H (px)',
      opacity: 'Background opacity',
      bg: 'Background',
      'bg.default': 'Theme',
      'bg.color': 'Color',
      bgColorLight: 'Light theme',
      bgColorDark: 'Dark theme',
      'bg.image': 'Image',
      bgUrl: 'Image URL',
      reset: 'Reset',
      saved: 'Saved',
      hint: 'Applies live; colors are stored per theme and follow theme switches; saved with the dsh profile',
      loadFailed: 'Failed to load settings',
    }

    var STYLES = [
      '.su-sec{display:flex;flex-direction:column;gap:10px;max-width:560px;font-size:13px}',
      '.su-sec .su-label{font-size:12px;opacity:.6}',
      '.su-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.su-chip{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;background:transparent;color:inherit}',
      '.su-chip.on{background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.2));font-weight:600}',
      '.su-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.su-k{opacity:.65;font-size:12px;white-space:nowrap}',
      '.su-num{width:76px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:6px;padding:2px 6px;font-size:12px;background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font-variant-numeric:tabular-nums}',
      '.su-mut{opacity:.7;font-variant-numeric:tabular-nums}',
      '.su-range{flex:1;min-width:110px;accent-color:var(--dsw-alias-state-positive,#3aa76d)}',
      '.su-color{width:44px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:6px;background:transparent;cursor:pointer}',
      '.su-text{flex:1;min-width:150px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:6px;padding:3px 8px;font-size:12px;background:var(--dsw-alias-bg-layer-2,transparent);color:inherit}',
      '.su-foot{display:flex;align-items:center;gap:10px;margin-top:2px}',
      '.su-hint{font-size:11px;opacity:.5;flex:1}',
      '.su-flash{font-size:12px;color:var(--dsw-alias-state-positive,#3aa76d)}',
      '.su-err{font-size:12px;color:var(--dsw-alias-state-error,#c75050)}',
    ].join('')

    function ensureStyles() {
      if (document.getElementById('dsh-settings-ui-ui') !== null) return
      var tag = document.createElement('style')
      tag.id = 'dsh-settings-ui-ui'
      tag.textContent = STYLES
      document.head.appendChild(tag)
    }

    /** Pure CSS generator (unit-tested via __internals). dark=false → light theme color. */
    function buildCss(s, dark) {
      s = s || {}
      var size = s.size || 'default'
      var opacity = Math.min(100, Math.max(30, Number(s.opacity) || 100))
      var bgMode = s.bgMode || 'default'
      if (size === 'default' && opacity >= 100 && bgMode === 'default') return ''
      var p = []
      if (size === 'large' || size === 'xlarge') {
        var pre = PRESETS[size]
        p.push('width:' + pre.w + 'px', 'height:min(' + pre.h + 'px, calc(100vh - 48px))')
      } else if (size === 'full') {
        p.push('width:100vw', 'height:100vh', 'max-width:none', 'border-radius:0')
      } else if (size === 'custom') {
        var w = Math.max(480, Number(s.customWidth) || DEFAULTS.customWidth)
        var hh = Math.max(360, Number(s.customHeight) || DEFAULTS.customHeight)
        p.push('width:min(' + w + 'px, calc(100vw - 48px))', 'height:min(' + hh + 'px, calc(100vh - 48px))')
      }
      var picked = dark ? s.bgColorDark : s.bgColorLight
      var base = bgMode === 'color' && picked ? picked : 'var(--dsw-alias-bg-layer-2)'
      var color = opacity < 100 ? 'color-mix(in srgb, ' + base + ' ' + opacity + '%, transparent)' : base
      p.push('background-color:' + color)
      if (bgMode === 'image' && s.bgUrl) {
        p.push('background-image:url("' + String(s.bgUrl).replace(/\\/g, '%5C').replace(/"/g, '%22') + '")',
          'background-size:cover', 'background-position:center')
      }
      return PANEL_SCOPED + '{' + p.join(';') + '}'
    }

    var tweakStyle = null
    var lastSettings = null
    var isDark = function () {
      try { return document.body.hasAttribute('data-ds-dark-theme') } catch { return false }
    }
    function applyCss(s) {
      if (typeof document === 'undefined') return
      if (s) lastSettings = s
      if (tweakStyle === null) {
        tweakStyle = document.getElementById(STYLE_ID)
        if (tweakStyle === null) {
          tweakStyle = document.createElement('style')
          tweakStyle.id = STYLE_ID
          document.head.appendChild(tweakStyle)
        }
      }
      if (lastSettings) tweakStyle.textContent = buildCss(lastSettings, isDark())
    }

    var getJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })

    // ── Settings section (the single entrance) ──

    function Section({ t }) {
      const [s, setS] = useState(null)
      const [flash, setFlash] = useState('')
      const [err, setErr] = useState('')
      useEffect(() => {
        getJson(API + '/status')
          .then((d) => { setS(d.settings || DEFAULTS); applyCss(d.settings) })
          .catch(() => setErr(t('loadFailed')))
      }, [])
      const save = (patch) => {
        const optimistic = { ...(s || DEFAULTS), ...patch }
        setS(optimistic)
        applyCss(optimistic)
        fetch(API + '/settings', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(optimistic),
        }).then((r) => r.json().catch(() => ({}))).then((d) => {
          if (d && d.settings) { setS(d.settings); applyCss(d.settings) }
          setFlash(t('saved')); setTimeout(() => setFlash(''), 1600)
        }).catch(() => setErr('HTTP ' + 'save failed'))
      }
      const num = (key, min) => {
        const input = h('input', {
          className: 'su-num', type: 'number', min, value: String(s[key]),
          onChange: (e) => {
            const v = Math.max(min, Number(e.target.value) || min)
            save({ [key]: v })
          },
          onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
        })
        return input
      }
      const chips = (keys, current, onPick) => h('div', { className: 'su-chips' },
        keys.map((k) => h('button', {
          key: k, type: 'button', className: 'su-chip' + (current === k ? ' on' : ''),
          'aria-pressed': String(current === k), onClick: () => onPick(k),
        }, t(k))))
      if (err !== '' && s === null) return h('div', { className: 'su-sec' }, h('span', { className: 'su-err' }, err))
      if (s === null) return h('div', { className: 'su-sec' }, '…')
      return h('div', { className: 'su-sec' },
        h('div', { className: 'su-row' },
          h('span', { className: 'su-label' }, t('size')),
          flash ? h('span', { className: 'su-flash' }, flash) : null,
          err ? h('span', { className: 'su-err' }, err) : null),
        chips(['size.default', 'size.large', 'size.xlarge', 'size.full', 'size.custom'], 'size.' + s.size, (k) => save({ size: k.replace('size.', '') })),
        s.size === 'custom'
          ? h('div', { className: 'su-row' },
            h('span', { className: 'su-k' }, t('customWH')),
            num('customWidth', 480), h('span', { className: 'su-k' }, '×'), num('customHeight', 360))
          : null,
        h('div', { className: 'su-label' }, t('opacity')),
        h('div', { className: 'su-row' },
          h('input', {
            className: 'su-range', type: 'range', min: 30, max: 100, step: 5,
            value: s.opacity,
            onChange: (e) => { const v = { ...s, opacity: Number(e.target.value) }; setS(v); applyCss(v) },
            onMouseUp: (e) => save({ opacity: Number(e.target.value) }),
            onKeyUp: (e) => save({ opacity: Number(e.target.value) }),
            onBlur: (e) => save({ opacity: Number(e.target.value) }),
          }),
          h('span', { className: 'su-mut' }, s.opacity + '%')),
        h('div', { className: 'su-label' }, t('bg')),
        chips(['bg.default', 'bg.color', 'bg.image'], 'bg.' + s.bgMode, (k) => save({ bgMode: k.replace('bg.', '') })),
        s.bgMode === 'color'
          ? ['Light', 'Dark'].map((which) => {
            const key = 'bgColor' + which
            const value = /^#[0-9a-fA-F]{6}$/.test(s[key]) ? s[key] : DEFAULTS[key]
            return h('div', { className: 'su-row', key },
              h('span', { className: 'su-k' }, t('bgColor' + which)),
              h('input', {
                className: 'su-color', type: 'color', value,
                onChange: (e) => { const patch = {}; patch[key] = e.target.value; save(patch) },
              }))
          })
          : null,
        s.bgMode === 'image'
          ? h('div', { className: 'su-row' },
            h('span', { className: 'su-k' }, t('bgUrl')),
            h('input', {
              className: 'su-text', type: 'text', placeholder: 'https://…', spellCheck: false,
              defaultValue: s.bgUrl,
              onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
              onBlur: (e) => { if (e.target.value.trim() !== s.bgUrl) save({ bgUrl: e.target.value.trim() }) },
            }))
          : null,
        h('div', { className: 'su-foot' },
          h('button', { className: 'su-chip', type: 'button', onClick: () => save({ ...DEFAULTS }) }, t('reset')),
          h('span', { className: 'su-hint' }, t('hint'))))
    }

    module.exports = {
      name: CLIENT_NAME,
      inject: ['slots', 'locale'],
      __internals: { buildCss, DEFAULTS, PANEL_SCOPED },
      apply(ctx) {
        let t = (key) => { const out = EN[key]; return out !== undefined ? out : key }
        try {
          if (ctx.locale && typeof ctx.locale.register === 'function') {
            ctx.locale.register(NS, 'zh', ZH)
            ctx.locale.register(NS, 'en', EN)
            const bound = typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : null
            if (bound) t = (key) => bound(key) || EN[key] || key
          }
        } catch { /* locale contract drift: keep EN fallback */ }
        ensureStyles()
        // 开机即应用一次：不打开设置 section 也让已保存的调整生效
        try { getJson(API + '/status').then((d) => applyCss(d && d.settings)).catch(() => {}) } catch {}
        // 亮暗切换实时跟随：主题服务切换 body[data-ds-dark-theme]，观察后重应用
        try {
          const observer = new MutationObserver(() => applyCss())
          observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
          ctx.effect(() => () => observer.disconnect(), 'dsh-settings-ui: theme observer')
        } catch { /* Observer 不可用：重启页面后仍会取对的主题色 */ }
        ctx.effect(() => {
          try {
            ctx.slots.inject('settings.section', () => ctx.slots.register({
              name: 'settings.section',
              id: CLIENT_NAME,
              order: 96,
              locale: NS,
              label: () => t('title'),
              inject: () => ({}),
            }, function SettingsSectionSlot() {
              return h(Section, { t })
            }))
          } catch (e) { try { console.error('[dsh-settings-ui] settings section:', e) } catch {} }
        }, 'dsh-settings-ui: settings section')
      },
    }

    return module.exports
  },
})
