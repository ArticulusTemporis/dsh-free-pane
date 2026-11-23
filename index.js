import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import http from 'node:http'
import dns from 'node:dns'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { exec as execChild, execFile as execFileChild } from 'node:child_process'

const RPC_BASE = '/_dsh/dsh-free-pane'
const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const MAX_SESSIONS = 40
const cache = new Map()
const cacheDeep = new Map()
// 调试用落盘：默认关闭，设 DSH_FREE_PANE_DEV=1 才写。
// proxy.json 例外——它只含本机端口，留着方便排查「代理没起来」。
const DEV = process.env.DSH_FREE_PANE_DEV === '1'
const ALWAYS_WRITE = new Set(['proxy.json'])

function devFile(name) {
  return path.join(os.tmpdir(), 'dsh-free-pane-' + name)
}

function devWrite(name, data) {
  if (!DEV && !ALWAYS_WRITE.has(name)) return
  try {
    fs.writeFileSync(devFile(name), typeof data === 'string' ? data : JSON.stringify(data, null, 1))
  } catch (e) {}
}

function sessionsRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'sessions')
}

function readSession(file, stat, deeper, tail) {
  const bag = deeper ? cacheDeep : cache
  const span = deeper ? (typeof tail === 'number' ? (tail < 0 ? -1 : Math.max(1200, tail)) : 1200) : 0
  const key = deeper ? file + '#' + span : file
  const hit = bag.get(key)
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.value
  let value = null
  try {
    const buf = fs.readFileSync(file)
    const starts = []
    let at = 0
    while (true) {
      const k = buf.indexOf(FRAME_MAGIC, at)
      if (k < 0) break
      starts.push(k)
      at = k + 4
    }
    const picked = new Set()
    // 标题事件会在整场对话里反复重写（自动起名、改名），只读开头会拿到最早的
    // 那版标题。优先读投影缓存（cachedTitle），这里只是兜底，所以只扫尾部
    // 1200 帧，别为了一次标题把一万多帧全解压（那会把宿主卡住好几秒）。
    const head = Math.min(deeper ? 3 : 3, starts.length)
    for (let n = 0; n < head; n++) picked.add(n)
    for (let n = Math.max(head, starts.length - 12); n < starts.length; n++) picked.add(n)
    if (deeper && span !== 0) {
      const from = span < 0 ? head : Math.max(head, starts.length - span)
      for (let n = from; n < starts.length; n++) picked.add(n)
    }
    const parts = []
    for (const n of picked) {
      const seg = buf.subarray(starts[n], n + 1 < starts.length ? starts[n + 1] : buf.length)
      try {
        parts.push(zlib.zstdDecompressSync(seg))
      } catch (err) {}
    }
    const lines = Buffer.concat(parts).toString('utf8').split('\n')
    let meta = null
    let title = ''
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n]
      if (!line) continue
      if (line.indexOf('"type":"session"') < 0 && line.indexOf('"type":"session/title"') < 0) continue
      let ev
      try {
        ev = JSON.parse(line)
      } catch (err) {
        continue
      }
      if (ev.type === 'session' && !meta) meta = ev
      else if (ev.type === 'session/title' && ev.data && typeof ev.data.title === 'string') title = ev.data.title
    }
    if (meta && typeof meta.id === 'string') {
      value = {
        id: meta.id,
        title,
        cwd: typeof meta.cwd === 'string' ? meta.cwd : '',
        createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
        updatedAt: stat.mtimeMs,
      }
    }
  } catch (err) {
    value = null
  }
  bag.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, value })
  return value
}

// 投影缓存 ~/.dsh/storages/session_projcache/sessions/<uuid>.json 里存着
// 每个会话最后一次写入的标题（一个小 JSON），比解压一万多帧快几个数量级。
function cachedTitle(id) {
  const uuid = String(id || '')
    .replace(/^session-/, '')
    .trim()
  if (!uuid) return ''
  const file = path.join(dshRoot(), 'storages', 'session_projcache', 'sessions', uuid + '.json')
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    const rows = doc && doc.record && doc.record.rows
    const val = rows && rows.title && rows.title.val
    return typeof val === 'string' ? val : ''
  } catch (err) {
    return ''
  }
}

// 上下文占用：宿主把「已用 / 窗口 / 分项」都算在投影缓存里。这里直接读它的数，
// 不抄 dsh-context 的界面 —— 数字同源，卡片是我们自己的。
function contextStats(id) {
  const uuid = String(id || '')
    .replace(/^session-/, '')
    .trim()
  if (!uuid) return null
  const dir = path.join(dshRoot(), 'storages', 'session_projcache', 'sessions')
  const cands = [uuid + '.json', 'session-' + uuid + '.json']
  try {
    let file = ''
    for (const c of cands) {
      const p = path.join(dir, c)
      if (fs.existsSync(p)) { file = p; break }
    }
    if (!file) return null
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    const rows = (doc && doc.record && doc.record.rows) || {}
    const pick = function (k) {
      const v = rows[k] && rows[k].val
      return v && typeof v === 'object' ? v : null
    }
    const pressure = pick('contextPressure')
    const breakdown = pick('contextBreakdown')
    const usage = pick('tokenUsage')
    const used = Number(pressure && pressure.pressureTokens) || 0
    const window = Number(pressure && pressure.contextWindow) || 0
    const bd = (breakdown && breakdown.breakdown) || {}
    return {
      id: 'session-' + uuid,
      used: used,
      window: window,
      surface: Number(pressure && pressure.surfaceTokens) || 0,
      pct: window > 0 ? Math.round((used / window) * 1000) / 10 : 0,
      system: Number(bd.systemTokens) || 0,
      tools: Number(bd.toolsTokens) || 0,
      messages: Number(bd.messageTokens) || 0,
      cacheRead: Number(usage && usage.totals && usage.totals.cacheReadTokens) || 0,
      output: Number(usage && usage.totals && usage.totals.outputTokens) || 0,
      // 下面这几组就是 dsh-context 那几张卡片读的同一份投影数据：
      // 会话统计 / Token 统计 / 每日用量 / 对话目录，各自能单独成为一张卡片。
      stats: (function () {
        const s = pick('sessionStats') || {}
        return {
          turns: Number(s.turns) || 0,
          steps: Number(s.steps) || 0,
          llmMs: Number(s.llmMs) || 0,
          toolMs: Number(s.toolMs) || 0,
          ttftMs: Number(s.ttftMs) || 0,
          decodeMs: Number(s.decodeMs) || 0,
          decodeTokens: Number(s.decodeTokens) || 0,
        }
      })(),
      tokens: (function () {
        const u = pick('tokenUsage') || {}
        const t = u.totals || {}
        const last = (u.last && u.last.buckets) || {}
        return {
          uncached: Number(t.uncachedInputTokens) || 0,
          output: Number(t.outputTokens) || 0,
          cacheRead: Number(t.cacheReadTokens) || 0,
          lastInput: Number(last.uncachedInputTokens) || 0,
          lastOutput: Number(last.outputTokens) || 0,
          lastCache: Number(last.cacheReadTokens) || 0,
        }
      })(),
      days: (function () {
        const a = pick('contextActivity') || {}
        const d = a.days || {}
        const keys = Object.keys(d).sort().slice(-7)
        return keys.map(function (k) {
          const v = d[k] || {}
          let billed = 0
          try {
            const provs = Object.values(v.cost || {})
            for (let i = 0; i < provs.length; i += 1) {
              const models = Object.values(provs[i] || {})
              for (let j = 0; j < models.length; j += 1) {
                const bands = Object.values(models[j] || {})
                for (let n = 0; n < bands.length; n += 1) {
                  const b = bands[n] || {}
                  billed += (Number(b.uncached) || 0) + (Number(b.cacheRead) || 0) + (Number(b.output) || 0)
                }
              }
            }
          } catch (eDays) {}
          return {
            day: k,
            tokens: Number(v.tokens) || 0,
            requests: Number(v.requests) || 0,
            billed: billed,
          }
        })
      })(),
      turns: (function () {
        const o = pick('turnOutline') || {}
        const list = Array.isArray(o.turns) ? o.turns : []
        return list.slice(-40).map(function (t) {
          return {
            turn: Number(t.turn) || 0,
            prompt: String(t.prompt || '').replace(/\s+/g, ' ').slice(0, 70),
          }
        })
      })(),
      model: (function () {
        const m = ((pick('modelSelection') || {}).lastUsed) || {}
        return m.provider && m.model ? m.provider + '/' + m.model : ''
      })(),
    }
  } catch (err) {
    return null
  }
}

// 列表里的标题只读了头 3 帧，很多会话早期写下的 session/title 拿不到，
// 于是显示成「会话 6ea8dd63」。窗口要看真实对话名时按 id 深扫一次。
function sessionTitle(id) {
  const want = String(id || '')
    .replace(/^session-/, '')
    .trim()
  if (!want) return null
  const fast = cachedTitle(id)
  if (fast) return { id: 'session-' + want, title: fast, cwd: '', from: 'projcache' }
  let workspaces
  try {
    workspaces = fs.readdirSync(sessionsRoot(), { withFileTypes: true })
  } catch (err) {
    return null
  }
  for (let a = 0; a < workspaces.length; a++) {
    if (!workspaces[a].isDirectory()) continue
    const wsDir = path.join(sessionsRoot(), workspaces[a].name)
    let entries
    try {
      entries = fs.readdirSync(wsDir, { withFileTypes: true })
    } catch (err) {
      continue
    }
    for (let b = 0; b < entries.length; b++) {
      if (!entries[b].isDirectory()) continue
      if (entries[b].name.replace(/^session-/, '') !== want) continue
      const file = path.join(wsDir, entries[b].name, 'session.v4.jsonl.zstd')
      let stat
      try {
        stat = fs.statSync(file)
      } catch (err) {
        continue
      }
      let row = readSession(file, stat, true, 1200)
      // 标题可能在很靠前的地方写过、之后再没改过（这一场 14233 帧，最后一次改名在 9008 帧），
      // 所以尾部没找到就逐步扩大窗口，最后才整场扫。
      const spans = [4800, -1]
      for (let s = 0; s < spans.length && (!row || !row.title); s += 1) {
        const again = readSession(file, stat, true, spans[s])
        if (again) row = again
      }
      return row ? { id: row.id, title: row.title || '', cwd: row.cwd || '' } : null
    }
  }
  return null
}

function dshRoot() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

// 归档状态不在会话文件里，而在宿主的 workspace 存储：~/.dsh/storages/workspace.json
// 的 global.archivedSessionIds（形如 "session-xxxxxxxx-…"）。
let archivedCache = { key: '', ids: new Set() }

function archivedIds() {
  const file = path.join(dshRoot(), 'storages', 'workspace.json')
  let stat
  try {
    stat = fs.statSync(file)
  } catch (err) {
    return archivedCache.ids
  }
  const key = String(stat.mtimeMs) + ':' + String(stat.size)
  if (archivedCache.key === key) return archivedCache.ids
  const ids = new Set()
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    const list = (doc && doc.global && doc.global.archivedSessionIds) || []
    for (let i = 0; i < list.length; i++) ids.add(String(list[i]))
  } catch (err) {
    return archivedCache.ids
  }
  archivedCache = { key: key, ids: ids }
  return ids
}

function isArchived(id, set) {
  const want = String(id || '')
  if (!want) return false
  if (!set.size) return false
  const full = want.indexOf('session-') === 0 ? want : 'session-' + want
  if (set.has(full)) return true
  const tail = full.replace(/^session-/, '')
  const it = set.values()
  for (let r = it.next(); !r.done; r = it.next()) {
    if (String(r.value).indexOf(tail) >= 0) return true
  }
  return false
}

function listSessions() {
  const archived = archivedIds()
  const files = []
  let workspaces
  try {
    workspaces = fs.readdirSync(sessionsRoot(), { withFileTypes: true })
  } catch (err) {
    return []
  }
  for (let a = 0; a < workspaces.length; a++) {
    if (!workspaces[a].isDirectory()) continue
    const wsDir = path.join(sessionsRoot(), workspaces[a].name)
    let entries
    try {
      entries = fs.readdirSync(wsDir, { withFileTypes: true })
    } catch (err) {
      continue
    }
    for (let b = 0; b < entries.length; b++) {
      if (!entries[b].isDirectory()) continue
      const file = path.join(wsDir, entries[b].name, 'session.v4.jsonl.zstd')
      let stat
      try {
        stat = fs.statSync(file)
      } catch (err) {
        continue
      }
      files.push({ file: file, stat: stat })
    }
  }
  files.sort(function (x, y) {
    return y.stat.mtimeMs - x.stat.mtimeMs
  })
  const out = []
  for (let n = 0; n < files.length && out.length < MAX_SESSIONS; n++) {
    const row = readSession(files[n].file, files[n].stat)
    if (!row) continue
    row.archived = isArchived(row.id, archived)
    if (!row.title) row.title = cachedTitle(row.id)
    out.push(row)
  }
  return out
}

function respond(res, status, body) {
  let text
  try {
    text = JSON.stringify(body)
  } catch (err) {
    text = '{"error":"encode failed"}'
  }
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

const FRAME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
// 一个网页超过这个尺寸基本不是我们想要的东西（图片/视频走的是直连地址，不走 /frame）。
const FRAME_MAX_BYTES = 16 * 1024 * 1024

// 浏览器卡片只允许「往外」走。/frame 会把目标站点的响应体原样搬回本机，
// 不挡住内网地址的话，任何被卡片打开的网页都能把它当成读本机的跳板：
// http://127.0.0.1:<代理口>/_dsh/...（同源、还带着我们的会话）、
// http://169.254.169.254/、家里的 NAS，全都在射程内。
const FRAME_BAD_NAME = /(^|\.)(localhost|local|internal|lan|home\.arpa|onion)$/i

// 私有 / 保留 / 环回段。沿用「宁可多拒」的判断：这些都是卡片不该去的地方。
function ipv4IsPrivate(ip) {
  const p = String(ip).split('.').map(Number)
  if (p.length !== 4) return true
  for (const n of p) if (!Number.isInteger(n) || n < 0 || n > 255) return true
  const a = p[0]
  const b = p[1]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0 && p[2] === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function frameHostBlocked(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.+$/, '')
  if (!h) return true
  // IPv6 字面量一律不放行（::1、fe80::、fc00:: 全在这一类里）。new URL 会保留方括号，
  // 所以看第一个字符就够；卡片指向 IPv6 字面量的需求基本为零，不值得再拆一套解析。
  if (h.charAt(0) === '[' || h.indexOf(':') >= 0) return true
  if (FRAME_BAD_NAME.test(h)) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return ipv4IsPrivate(h)
  return false
}

// 名字过关还不够：公网域名可以解析到 127.0.0.1（DNS rebinding、127.0.0.1.nip.io 之类），
// 所以再解析一次，任何一条记录落在私有段就拒。挡不住「校验后 fetch 时换地址」的竞态，
// 但把门槛从「随便写个内网地址」抬到「得先控制一个解析结果稳定的域名」。
async function frameTargetAllowed(u) {
  if (!u || !/^https?:\/\//i.test(String(u.href || ''))) return false
  if (!u.hostname || frameHostBlocked(u.hostname)) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return true
  let found = []
  try {
    found = await dns.promises.lookup(u.hostname, { all: true, verbatim: true })
  } catch (eLook) {
    return false
  }
  if (!found.length) return false
  for (const one of found) {
    if (one.family === 4 && ipv4IsPrivate(one.address)) return false
    if (one.family === 6) {
      const a6 = String(one.address || '').toLowerCase()
      if (a6 === '::1' || a6 === '::') return false
      if (a6.indexOf('fe80:') === 0) return false
      if (a6.indexOf('fc') === 0 || a6.indexOf('fd') === 0) return false
      if (a6.indexOf('::ffff:127.') === 0) return false
    }
  }
  return true
}

// 把外部页面搬进本机的 origin 里：这样它既能塞进窗口（不怕 X-Frame-Options），
// 我们也能进它的 document 接管链接点击、切标签页。
async function serveFrame(url, res) {
  let target = null
  try {
    target = new URL(String(url.searchParams.get('url') || ''))
  } catch (eBad) {
    respond(res, 400, { error: 'bad url' })
    return
  }
  if (!(await frameTargetAllowed(target))) {
    respond(res, 400, { error: 'blocked-host' })
    return
  }
  // 手动跟跳转。原来这种地方用的是 redirect:'follow'，等于让 fetch 自己带着我们
  // 去任何地方：白名单只校验了第一跳，第二跳指向 127.0.0.1 就白校验了。
  // 现在每一跳都重新过白名单，最多 3 跳（够 http→https、补斜杠、短链这几类）。
  // 也没有把 3xx 直接甩给浏览器：那样这一格会跳到真正的外站 origin，注入的
  // 链接接管与 X-Frame-Options 中和全部失效，页面反而更容易变成一块空白。
  let upstream = null
  let finalUrl = target
  for (let hop = 0; hop < 4; hop += 1) {
    let next = null
    try {
      // 只带这三个头。不转 cookie（外站页面绝不该碰到我们的会话），也不伪造
      // sec-fetch-site / origin / referer —— 那几个是浏览器在替自己作证，服务端
      // 替它填等于把「这请求到底是谁发的」说糊，出了事也查不出来。
      next = await fetch(finalUrl.href, {
        redirect: 'manual',
        headers: {
          'user-agent': FRAME_UA,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      })
    } catch (err) {
      respond(res, 502, { error: 'fetch failed: ' + String((err && err.message) || err) })
      return
    }
    if (next.status >= 300 && next.status < 400) {
      const loc = String(next.headers.get('location') || '')
      // 3xx 的 body 不要，读完丢掉，免得连接挂着。
      try { await next.arrayBuffer() } catch (eDrain) {}
      if (!loc) {
        respond(res, 502, { error: 'redirect without location' })
        return
      }
      let hopUrl = null
      try {
        hopUrl = new URL(loc, finalUrl)
      } catch (eLoc) {
        respond(res, 502, { error: 'bad redirect target' })
        return
      }
      if (!(await frameTargetAllowed(hopUrl))) {
        respond(res, 400, { error: 'blocked-host' })
        return
      }
      finalUrl = hopUrl
      continue
    }
    upstream = next
    break
  }
  if (!upstream) {
    respond(res, 502, { error: 'too many redirects' })
    return
  }
  const type = String(upstream.headers.get('content-type') || 'application/octet-stream')
  // 顺手给自己一个上限：整块 arrayBuffer 读进内存，又没有超时，拉到个几 GB 的
  // 地址就能把宿主进程的内存打满——这跟 SSRF 是同一类「别让远端决定我们花多少资源」。
  const declared = Number(upstream.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > FRAME_MAX_BYTES) {
    respond(res, 502, { error: 'response too large' })
    return
  }
  const rawBody = Buffer.from(await upstream.arrayBuffer())
  if (rawBody.length > FRAME_MAX_BYTES) {
    respond(res, 502, { error: 'response too large' })
    return
  }
  const head = { 'cache-control': 'no-store', 'x-dsh-frame': '1' }
  if (type.toLowerCase().indexOf('text/html') < 0) {
    head['content-type'] = type
    head['content-length'] = rawBody.length
    res.writeHead(upstream.status, head)
    res.end(rawBody)
    return
  }
  let html = rawBody.toString('utf8')
  // 页面自己声明的「不许被嵌入」一律中和；真正的响应头在 fetch 后已无意义。
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')
  html = html.replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, '')
  if (!/<base[\s>]/i.test(html)) {
    // 用的是跟完跳转之后的地址：短链/带斜杠的跳转如果还按第一跳拼 base，
    // 页面里的相对链接就会指回上一跳的主机。
    const base = '<base href="' + finalUrl.href.replace(/"/g, '&quot;') + '">'
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1>' + base)
    else html = base + html
  }
  // 网页里点链接不该把这一格导航走：交给父页面开一个新标签页。
  // 用代理自己注入的脚本转发（同源 iframe 也能用，且不依赖面板里的 click 钩子）。
  const navScript = '<script>(function(){document.addEventListener("click",function(e){' +
    'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;' +
    'var h=String(a.getAttribute("href")||"");if(!h||h.charAt(0)==="#")return;' +
    'var u;try{u=new URL(a.href,document.baseURI).href}catch(er){return}' +
    'if(!/^https?:/i.test(u))return;e.preventDefault();' +
    'try{parent.postMessage({fpNav:1,url:u},"*")}catch(er2){}' +
    '},true);})();</script>'
  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, navScript + '</body>')
  else html += navScript
  const body = Buffer.from(html, 'utf8')
  head['content-type'] = 'text/html; charset=utf-8'
  head['content-length'] = body.length
  res.writeHead(upstream.status, head)
  res.end(body)
}

let AUTH_URL = ''
let AUTH_PATH = ''
let WEB_CTX = null
let HOST_CTX = null
let TARGET = null
let PROXY_SERVER = null
let PROXY_PORT = 0
let PROXY_COOKIE = ''

function proxyTarget() {
  return TARGET
}

function refreshProxyCookie() {
  const t = TARGET
  if (!t || !AUTH_PATH) return
  try {
    http.get({
      hostname: '127.0.0.1',
      port: t.port,
      path: AUTH_PATH,
      headers: { host: t.host },
    }, function (res) {
      const raw = res.headers['set-cookie']
      if (raw && raw.length) {
        PROXY_COOKIE = raw.map(function (c) { return String(c).split(';')[0] }).join('; ')
      }
      res.resume()
    }).on('error', function () {})
  } catch (e) {}
}

let PROXY_SERVERS = []
let PROXY_PORTS = []
// 最多同时挂起 9 个会话界面：每个会话窗要一个独立 origin，才不会互相饿死。
const PROXY_COUNT = 9

// 每份嵌进来的客户端都从**不同 origin** 取同一份资源：浏览器的同源连接数是 6，
// 两份客户端挤在一个 origin 上会互相饿死（第二份永远停在 Loading plugins…）。
// 所以代理可以起多份，每个监听口就是一个独立的 origin。
function proxyHandler(req, res) {
      try {
        const t = TARGET
        if (!t) {
          try {
            res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('free-pane proxy: no target')
          } catch (e) {}
          return
        }
        // /frame 在代理这一层直接处理：宿主那条路由要过 connection 的鉴权，
        // dsh-app:// 里的 iframe 是跨站请求、不带会话 cookie，只会拿回 {"error":"rejected"}。
        //
        // 这段必须留在下面 `headers.cookie = PROXY_COOKIE` 那行**之前**，并且永远不要在
        // serveFrame 里补 cookie：/frame 搬进来的是「别人的页面」，它和我们的副本同源，
        // 一旦这份响应也带上会话，卡片里的网页就能直接调 /_dsh/* 的写接口。
        try {
          const frameUrl = new URL(String(req.url || '/'), 'http://127.0.0.1')
          if (frameUrl.pathname === '/_dsh/dsh-free-pane/frame') {
            serveFrame(frameUrl, res).catch(function (frameErr) {
              try { respond(res, 500, { error: String((frameErr && frameErr.message) || frameErr) }) } catch (frameErr2) {}
            })
            return
          }
        } catch (frameParse) {}
        const headers = Object.assign({}, req.headers)
        headers.host = t.host
        if (headers.origin) headers.origin = `${t.protocol}//${t.host}`
        if (headers.referer) {
          try {
            const ref = new URL(String(headers.referer))
            headers.referer = `${t.protocol}//${t.host}${ref.pathname}${ref.search}`
          } catch (refErr) {
            headers.referer = `${t.protocol}//${t.host}/`
          }
        }
        // 跨站发起的 RPC 不带会话：浏览器会替我们自己声明 sec-fetch-site，
        // 那是个少见但白送的信号——别的站点用一个「简单请求」POST 过来时它是 cross-site，
        // 我们就不替它补 cookie，免得整台本机的 RPC（含 /exec）变成任意网页的遥控器。
        // 副本自己的请求都是同源 fetch，sec-fetch-site 是 same-origin，不受影响。
        const crossSite = String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site'
        if (crossSite && String(req.url || '').indexOf('/_dsh/') === 0) {
          delete headers.cookie
          if (DEV) { try { fs.appendFileSync(path.join(os.tmpdir(), 'dsh-free-pane-proxy.log'), 'no-cookie cross-site ' + String(req.url).slice(0, 120) + '\n') } catch (eDev) {} }
        } else if (PROXY_COOKIE) {
          headers.cookie = PROXY_COOKIE
        }
        delete headers['accept-encoding']

        const wantSession = (function () {
          try {
            const u = new URL(String(req.url || '/'), 'http://127.0.0.1')
            if (req.method !== 'GET') return ''
            if (u.pathname !== '/' && u.pathname !== '/index.html') return ''
            return String(u.searchParams.get('autoSession') || '')
          } catch (e) {
            return ''
          }
        })()

        const wantPanel = (function () {
          try {
            const u = new URL(String(req.url || '/'), 'http://127.0.0.1')
            if (req.method !== 'GET') return ''
            if (u.pathname !== '/' && u.pathname !== '/index.html') return ''
            return String(u.searchParams.get('gridPanel') || '')
          } catch (e) {
            return ''
          }
        })()

        // fpEmbed=pure（纯净对话）| panel:<kind>（只留右栏的那个面板）| off（什么都不做）
        const wantEmbed = (function () {
          try {
            const u = new URL(String(req.url || '/'), 'http://127.0.0.1')
            if (req.method !== 'GET') return ''
            if (u.pathname !== '/' && u.pathname !== '/index.html') return ''
            return String(u.searchParams.get('fpEmbed') || '')
          } catch (e) {
            return ''
          }
        })()

        const up = http.request({
          hostname: '127.0.0.1',
          port: t.port,
          path: req.url,
          method: req.method,
          headers,
        }, function (upRes) {
          const out = Object.assign({}, upRes.headers)
          delete out['set-cookie']
          try {
            if (DEV) fs.appendFileSync(path.join(os.tmpdir(), 'dsh-free-pane-proxy.log'), String(upRes.statusCode) + ' ' + String(req.method) + ' ' + String(req.url).slice(0, 160) + '\n')
          } catch (e) {}
          upRes.on('error', function () {})
          // 只给「宿主自己的页面」注入脚本；/frame 搬进来的外部网页必须原样返回，
          // 否则会被我们的取点层、雾化层污染（实测 bing 结果页被注入后整页空白）。
          const ownPage = String(req.url || '/').indexOf('/_dsh/') !== 0
          if (ownPage && String(out['content-type'] || '').indexOf('text/html') === 0) {
            const chunks = []
            upRes.on('data', function (chunk) { chunks.push(chunk) })
            upRes.on('end', function () {
              try {
                let body = Buffer.concat(chunks).toString('utf8')
                const safe = JSON.stringify(wantSession).replace(/</g, '\\u003c')
                const safePanel = JSON.stringify(wantPanel).replace(/</g, '\\u003c')
                const safeEmbed = JSON.stringify(wantEmbed).replace(/</g, '\\u003c')
                // 嵌入副本的额外样式：纯净对话（左右栏都关掉、不留白边、去掉每条消息的按钮）
                // 与官方面板（只留右栏，右栏自己会被撑成全屏）。
                let embedCss = ''
                // 副本里那条「对话列固定 max-width、两侧留白」在窄窗里就是一条大白边。
                // 把列本身放开到整宽，气泡与代码块跟着走，右边缘不再空一块。
                const fillCss =
                  '[class*=centerCol]{--dsh-composer-card-max-width:none!important;' +
                  '--dsh-composer-side-clearance:0px!important;' +
                  // 窗格里一份客户端会被整体缩放，正文常常小到看不清；直接把
                  // 宿主那套字号变量抬上去，比再压 zoom 更安全（布局不会变形）。
                  '--dsh-content-font-size:15px!important;' +
                  '--dsh-content-font-size-secondary:13.5px!important}' +
                  '[class*=centerCol] [class*=msg],[class*=centerCol] [class*=message],' +
                  '[class*=centerCol] [class*=markdown]{font-size:15px!important;line-height:1.72!important}' +
                  '[class*=centerCol] [class*=stack],[class*=scrollBody],[class*=viewArea]{' +
                  'max-width:none!important}' +
                  '[class*=column]{max-width:none!important}'
                if (wantEmbed === 'pure') {
                  embedCss +=
                    '[class*=centerCol]{--dsh-composer-card-max-width:none!important;' +
                    '--dsh-composer-side-clearance:0px!important}' +
                    '[class*=centerCol] [class*=stack]{max-width:none!important}' +
                    '[class*=rightbarCol],[class*=rightbar-col]{display:none!important}' +
                    // 右栏里那个 860px 的「空面板」是 push 模式的 sidebar panel，父列宽度为 0
                    // 时它仍会按 fixed/absolute 铺出来，形成一条白色空栏；按宿主的稳定
                    // data-* 属性连面板本体和它的会话壳一起收掉。
                    '[data-sidebar-right-panel],[data-sidebar-right-session]{display:none!important}' +
                    '[data-dockkit-empty="true"]{display:none!important}' +
                    // 真正的那条白栏不是面板本身：对话布局 body 留了 320px 的 margin-right
                    // 给「push 模式右侧栏」，面板藏了但外边距还在，右边就空一条。
                    '[class*=centerCol] [class*=body]{margin-right:0!important;width:100%!important;max-width:none!important}' +
                    // 进到会话里之后才收左栏：导航要靠抽屉里的会话行，提前收掉就再也点不到了。
                    // （侧栏本身含 tabLayout，hideSiblings 的「别藏面板宿主」规则会跳过它，
                    //  所以只能在这里按类名收。）
                    'html[data-fp-ok] [class*=sidebarCol],html[data-fp-ok] [class*=sidebar-column],' +
                    // 窄窗口里侧栏是抽屉（另一份 DOM，类名带 drawer），进会话后连抽屉一起收。
                    'html[data-fp-ok] [class*=drawer]{display:none!important}' +
                    fillCss
                } else if (wantEmbed === 'off') {
                  // 完整副本：左右栏都留着（跟宿主里看到的一样）。右栏只有
                  // 「展开着、里面什么都没有」时才收掉——那才是看起来像凭空
                  // 多出一个白窗格的原因，由脚本里的 tidyRightbar() 判断。
                  embedCss += fillCss
                } else if (wantEmbed === 'main') {
                  // 主区展示位（左栏那一排图标里的某个面板）：只留中间那一列，
                  // 左右两栏都收掉，面板自己占满。
                  embedCss +=
                    '[class*=sidebarCol],[class*=sidebar-column],[class*=rightbarCol],' +
                    '[class*=rightbar-col]{display:none!important}' +
                    '[class*=centerCol]{flex:1 1 auto!important;max-width:none!important}' +
                    '[class*=centerCol] [class*=stack]{max-width:none!important}' +
                    fillCss
                } else if (String(wantEmbed).indexOf('panel:') === 0) {
                  // 结构实测：panelBody > surface > tabLayout > tabCell > tabHost
                  // > (tabHostHeader 高度 38 = tab 条 / tabHostBody = 正文)。
                  // 面板窗只要正文，条与按钮条全部不出现，正文自己撑满。
                  embedCss +=
                    '[class*=sidebarCol],[class*=sidebar-column],[class*=centerCol]{display:none!important}' +
                    '[class*=panelBody]{padding:0!important}' +
                    '[class*=tabHostHeader]{display:none!important}' +
                    '[class*=tabHostBody],[class*=paneBody],[class*=tabCell],' +
                    '[class*=tabLayout],[class*=surface_],[class*=panelBody]{' +
                    'height:100%!important;max-height:none!important;min-height:0!important}'
                }
                // 副本右上角这一排（会话详情 / 更多操作 / 打开右侧边栏）在窗口里没有意义，
                // 而且「打开右侧边栏」会把副本自己的栏拉出来，把对话挤窄。按稳定的
                // data-slot / data-sidebar-right-expand / aria-label 关掉，不依赖哈希类名。
                const hideHead =
                  '[data-slot="conversation.session.header.utilities"] button,' +
                  '[data-slot="conversation.session.header.corner"] button,' +
                  'button[data-sidebar-right-expand="true"],' +
                  'button[aria-label="会话详情"],button[aria-label="更多操作"],' +
                  'button[aria-label="打开右侧边栏"],button[aria-label="收起右侧栏"],' +
                  '.dsh-claude-details-root,[class*=dsh-claude-details]{' +
                  'display:none!important;pointer-events:none!important}'
                if (wantEmbed) embedCss += hideHead
                const embed = [
                  '(function(){',
                  // 副本里宿主有时会把页面重载成裸地址（丢掉 autoSession/fpEmbed），
                  // 那时脚本仍在，但参数没了。把这两样东西记进 sessionStorage，
                  // 任何时候都能接着干活，不会退回到「欢迎页」。
                  'var SS=null;try{SS=window.sessionStorage}catch(eSS){SS=null}',
                  'var SID=' + safe + ';',
                  'var PANEL=' + safePanel + ';',
                  'var EMBED=' + safeEmbed + ';',
                  'try{if(!SS)throw 0;if(SID)SS.setItem("fpSid",String(SID));else SID=SS.getItem("fpSid")||"";}catch(eS){SID=SID||""}',
                  'try{if(!SS)throw 0;if(EMBED)SS.setItem("fpMode",String(EMBED));else EMBED=SS.getItem("fpMode")||"off";}catch(eE){EMBED=EMBED||"off"}',
                  'if(!PANEL){try{PANEL=(SS&&SS.getItem("fpPanel"))||""}catch(eP){PANEL=PANEL||""}}',
                  'var EXTRA=' + JSON.stringify(embedCss).replace(/</g, '\\u003c') + ';',
                  'var ZOOM=1;',
                  'var d=document;',
                  // 只在「窗格里的副本」里动手：顶层页面（代理本身、也就是用户正常用
                  // 的那个界面）绝对不能被改造成固定定位，否则中间列会与自己的宽度
                  // 脱节，看起来「只有一半」。
                  'if(window.top===window.self&&!/[?&]fpForce=1/.test(String(window.location.search||"")))return;',
                  // 走到这里说明这份文档确实是窗格里的副本。先扔一颗「我活着」的信标，
                  // 后面任何一步炸掉都能从日志看出来是脚本没跑还是跑了一半。
                  'try{navigator.sendBeacon("/_dsh/dsh-free-pane/log",new Blob([JSON.stringify({name:"inject-boot",sid:String(SID),embed:String(EMBED)})],{type:"application/json"}))}catch(eB){}',
                  'var rootEl=d.documentElement;',
                  // 拉起来的那几秒先雾化：等对话真的出现再揭幕，省得看着一个空白窗格发呆。
                  'var VEIL=(function(){try{var v=d.createElement("div");v.setAttribute("style","position:fixed;inset:0;z-index:2147481000;backdrop-filter:blur(12px) saturate(.92);background:rgba(250,251,253,.45);display:flex;align-items:center;justify-content:center;font:13px/1.6 system-ui,sans-serif;color:rgba(20,24,32,.62);letter-spacing:.02em;transition:opacity .32s;pointer-events:none");v.textContent="正在拉起这个对话…";d.documentElement.appendChild(v);return v}catch(eV){return null}})();',
                  'function dropVeil(){try{if(!VEIL)return;var v=VEIL;VEIL=null;v.style.opacity="0";setTimeout(function(){try{v.parentNode&&v.parentNode.removeChild(v)}catch(e2){}},340)}catch(e3){}}',
                  // 中心列直接脱离原布局：固定铺满视口。这样父容器剩多少宽度都与它无关，
                  // 隐藏左右两栏之后不会在左侧留出空白。
                  'var CSS=[' +
                  '"html,body{overflow:hidden!important;margin:0!important}",' +
                  '"[class*=overlayLayer],[class*=drawerMask],[class*=toastRoot],[class*=modalLayer]{display:none!important}",' +
                  '".dshwv-root,[class*=nekowhale],[class*=dsh-whale],[id*=dsh-whale]{display:none!important}",' +
                  // 纯净对话：不要动布局（以前把 centerCol 改成 position:fixed 铺满视口，
                  // 结果中间列与自己的宽度脱节、右边永远剩一条白框）。左栏右栏藏掉之后，
                  // 让宿主自己的 flex 把它撑满就行。
                  // 宿主把三栏写成**内联**的 `grid-template-columns: 280px minmax(0,1fr) minmax(0,0px)`
                  // 并且宽度由 JS 现算（窗口一变就重写），所以从外面改模板列压不住：藏掉左右两栏之后
                  // 侧栏那条 track 还留着宽度（实测 1610px 宽的卡里剩 111px 空白，宽卡里就是一条
                  // 「对话右边/旁边的空栏」）。可靠的办法是让中间列**跨满所有 track** —— 它跨到
                  // 1/-1 之后，管你模板列怎么算，对话列都铺满整块卡。
                  '(EMBED==="pure"?' +
                  '"[class*=centerCol]{position:static!important;flex:1 1 auto!important;width:auto!important;min-width:0!important;' +
                  'max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;transform:none!important}' +
                  // 跨满轨道这条**只在对话已经进去之后**（data-fp-ok）才生效：那时候左右两栏已经藏了。
                  // 早一点生效会把中间列铺到侧栏下面——侧栏还在、却被盖住，点工作区行/会话行
                  // 全被中间列接走（单独窗口停在欢迎页就是这么来的，实测 130 秒点 40 多次都没反应）。
                  'html[data-fp-ok] [class*=centerCol]{grid-column:1/-1!important;justify-self:stretch!important}' +
                  '[class*=centerCol] [class*=stack]{max-width:none!important}"' +
                  ':' +
                  '"[class*=centerCol]{position:fixed!important;left:0!important;top:0!important;right:0!important;bottom:0!important;' +
                  'width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;' +
                  'margin:0!important;transform:none!important;z-index:1!important}"' +
                  '),' +
                  // 窗格里不要每条回复右上角那一排小按钮（列表 / 更多 / 展开）。加 fpChrome=1 可以保留。
                  '(/[?&]fpChrome=1/.test(location.search)?"":"[class*=msg] [class*=action],[class*=message] [class*=action],[class*=turn] [class*=action],[class*=bubble] [class*=action],[class*=msgActions],[class*=messageActions],[class*=msgToolbar],[class*=messageToolbar]{display:none!important}"),' +
                  '].join("");',
                  'function ensureStyle(){',
                  'if(d.getElementById("fp-embed-style"))return;',
                  'var s=d.createElement("style");s.id="fp-embed-style";s.textContent=CSS+EXTRA;',
                  '(d.head||rootEl).appendChild(s);',
                  '}',
                  // 纯净模式的右栏面板要在第一帧就收掉；以前等 tickBody（会话 ok 之后）
                  // 才注入，加载期间那条 860px 的「空面板」会一直铺在右边。
                  'try{ensureStyle()}catch(eStyleEarly){}',
                  // 只遍历兄弟节点（个位数），不做全页扫描，避免阻塞主线程。
                  'function hideSiblings(){',
                  'var c=d.querySelector(\'[class*="centerCol"]\');',
                  'if(!c||!c.parentElement)return;',
                  // 藏之前先把中间列 c 记住：纯净模式靠 CSS 的 grid-column:1/-1 让对话列跨满所有
                  // 轨道（宿主内联算模板列，见上面 CSS 注释），这里不用再动父容器的 display/模板。
                  'var k=c.parentElement.children;',
                  'for(var i=0;i<k.length;i++){var el=k[i];if(el===c)continue;',
                  'if(el.querySelector&&el.querySelector(\'[class*="tabLayout"]\'))continue;',
                  'if(el.style.display!=="none")el.style.display="none";}',
                  '}',
                  // 面板窗只留一块板：从 panelBody 往上逐层把兄弟节点藏掉，一直到 body。
                  // 宿主的 tab 条、面板标题栏、右上角那排按钮都不必按类名去猜——
                  // 类名是构建哈希，换版本就变；结构不会。
                  'function soloPanel(){',
                  'var pb=d.querySelector(\'[class*="panelBody"]\');',
                  'if(!pb)return;',
                  // 面板本身通常长在右栏里，而右栏是 grid 的一条 track（占视口 45%）。
                  // 只把祖先的 height 撑满不够——宽度得用 important 顶掉 track 与 flex 基准，
                  // 否则面板会留在右半边、左边空一大块。
                  'var full=function(el){',
                  'el.style.setProperty("display","block","important");',
                  'el.style.setProperty("position","static","important");',
                  'el.style.setProperty("width","100%","important");',
                  'el.style.setProperty("height","100%","important");',
                  'el.style.setProperty("max-width","none","important");',
                  'el.style.setProperty("max-height","none","important");',
                  'el.style.setProperty("min-width","0","important");',
                  'el.style.setProperty("min-height","0","important");',
                  'el.style.setProperty("margin","0","important");',
                  'el.style.setProperty("padding","0","important");',
                  'el.style.setProperty("flex","1 1 100%","important");',
                  'el.style.setProperty("grid-column","1 / -1","important");',
                  'el.style.setProperty("grid-row","1 / -1","important");',
                  'el.style.setProperty("transform","none","important");',
                  'el.style.setProperty("inset","auto","important");',
                  'el.style.setProperty("overflow","hidden","important");',
                  '};',
                  'var n=pb,g=0;',
                  'while(n&&n!==d.body&&g++<12){',
                  'var par=n.parentElement;if(!par)break;',
                  'var k=par.children;',
                  'for(var i=0;i<k.length;i++){var el=k[i];if(el===n||el.nodeType!==1)continue;',
                  'if(el.style.display!=="none")el.style.display="none";}',
                  'full(n);',
                  'n=par;',
                  '}',
                  'if(d.body){d.body.style.setProperty("margin","0","important");d.body.style.setProperty("height","100%","important");}',
                  'if(rootEl.style.height===""||rootEl.style.height==="auto")rootEl.style.height="100%";',
                  '}',
                  // 直挂 body 的浮层（宠物、报价气泡、通知）一律隐藏，只保留应用根节点。
                  'function hideBodyLayers(){',
                  'if(!d.body)return;',
                  // 只藏「小挂件」（宠物、吐司、悬浮提示）。整屏那一层是这份副本自己的
                  // 皮肤/背景，藏掉它副本就变透明了——但也不自己去写任何颜色。
                  'var vw=d.documentElement.clientWidth||1;',
                  'var vh=d.documentElement.clientHeight||1;',
                  'var area=vw*vh*0.85;',
                  'var k=d.body.children;',
                  'for(var i=0;i<k.length;i++){',
                  'var el=k[i];if(el.nodeType!==1)continue;',
                  'if(el.id==="root"||el.tagName==="SCRIPT"||el.tagName==="STYLE")continue;',
                  'var box=el.getBoundingClientRect();',
                  'if(box.width*box.height>=area)continue;',
                  'if(el.style.display!=="none")el.style.display="none";',
                  '}',
                  '}',
                  // 打开会话：点对了才算数。列表是虚拟化的，行可能还没渲染出来；
                  // 也不能点一下就当成功——页面还没挂上处理器时点击是空转。
                  // 判断标准只有一条：编辑框真的出现了。
                  'var tries=0;var ok=false;',
                  // 会话行不一定带 "session-" 前缀（磁盘目录两种写法都有），
                  // 所以只拿 uuid 去匹配，别整串对上。
                  'var UUID=String(SID).replace(/^session-/,"");',
                  // 每 tick 都要问「目标会话的行在哪」：以前是 5 条属性子串选择器各走一遍
                  // querySelector（每条都是一次全文档扫描，扫描次数 × 5）。现在只扫一遍、
                  // 命中就记住元素（isConnected 自校验，虚拟列表换行时会自动失效重找）。
                  'function sessionRow(){',
                  'if(!UUID)return null;',
                  'var cached=window.__fpRowEl;',
                  'if(cached&&cached.isConnected)return cached;',
                  'var best=null;',
                  'try{',
                  'var n=d.querySelectorAll("[data-row-key],[data-session-id],[data-key],[data-id]");',
                  'for(var i=0;i<n.length;i++){',
                  'var e=n[i];',
                  'var k=String(e.getAttribute("data-row-key")||e.getAttribute("data-session-id")||e.getAttribute("data-key")||e.getAttribute("data-id")||"");',
                  'if(k&&k.indexOf(UUID)>=0){best=e;break;}',
                  '}',
                  '}catch(e1){best=null}',
                  'if(!best&&UUID){try{best=d.querySelector("a[href*=\'"+UUID+"\']")}catch(e2){best=null}}',
                  'window.__fpRowEl=best||null;',
                  'return best;',
                  '}',
                  // 行上的 data-row-key 不一定存在（窄窗口/虚拟列表/换版本），
                  // 所以再备一条「按会话标题认行」的路：标题从宿主导由取真名，再去侧栏里找它。
                  'var TITLE="";',
                  'function fetchTitle(){',
                  'if(TITLE||!UUID||window.__fpTitleAsked)return;',
                  'window.__fpTitleAsked=1;',
                  'try{',
                  'fetch("/_dsh/dsh-free-pane/sessionTitle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:"session-"+UUID})}).then(function(r){return r.json()}).then(function(v){if(v&&v.ok&&v.title)TITLE=String(v.title);window.__fpTitleAsked=0}).catch(function(){window.__fpTitleAsked=0});',
                  '}catch(e){window.__fpTitleAsked=0}',
                  '}',
                  // 标题兜底也只在「真的找不到行」时才跑，而且：
                  //  - 只扫可点的行元素（以前把 div/span/li 一起扫，光侧栏就是几千个节点，
                  //    每个都取 textContent——容器节点的 textContent 会把整棵子树拼一遍）；
                  //  - 结果记住，命中元素还在 DOM 里就复用。
                  'var titleRowAt=0;',
                  'function titleRow(){',
                  'if(!TITLE||TITLE.length<4)return null;',
                  'var cached=window.__fpTitleRow;',
                  'if(cached&&cached.isConnected)return cached;',
                  'var now=Date.now();',
                  'if(now-titleRowAt<1200)return null;',
                  'titleRowAt=now;',
                  'var sc=null;',
                  'try{sc=d.querySelector("[class*=sidebarCol],[class*=sidebar-col],[data-sidebar-collapsed]")}catch(e){sc=null}',
                  'if(!sc)sc=d.body;',
                  'var all=sc.querySelectorAll("a,button,[role=button],[role=treeitem],[role=option]");',
                  'var best=null;var bestLen=1e9;',
                  'for(var i=0;i<all.length;i++){',
                  'var el=all[i];var t=String(el.textContent||"").replace(/\\s+/g," ").trim();',
                  'if(!t||t.length>120)continue;',
                  'if(t.indexOf(TITLE)<0)continue;',
                  'if(t.length<bestLen){bestLen=t.length;best=el}',
                  '}',
                  'if(!best)return null;',
                  'var w=best;',
                  'try{w=best.closest("button,a,[role=button],[role=treeitem],[role=option]")||best}catch(e){w=best}',
                  'window.__fpTitleRow=w;',
                  'return w;',
                  '}',
                  // 每 tick 都读 offsetWidth 就等于每 tick 强制一次同步布局（React 正在挂载时
                  // 最贵的事情之一），所以：一次 querySelector 拿第一个候选，读一次几何，
                  // 结果缓存 400ms。
                  'function hasComposer(){',
                  // 新版的输入框不是 textarea，而是个 contenteditable 的富文本块，
                  // 只认 textarea 就会一直判成「还没进会话」——侧栏永远收不起来。
                  'var now=Date.now();',
                  'if(window.__fpCcAt&&now-window.__fpCcAt<400)return window.__fpCc;',
                  'var res=false;',
                  'try{',
                  'var el=d.querySelector("[contenteditable=true],[role=textbox],textarea,[class*=composer]");',
                  'if(el){res=(el.offsetWidth>80&&el.offsetHeight>8);}',
                  '}catch(e0){res=false}',
                  'window.__fpCcAt=now;window.__fpCc=res;',
                  'return res;',
                  '}',
                  // 欢迎页的侧栏只列工作区、不列会话：得先点开某个工作区，它的会话行才出现。
                  // 而且不能只点第一行——目标会话未必在第一个工作区里（以前就是这样卡住的）。
                  // 做法：把工作区行从头到尾点一轮（每个 0.7 秒），然后停 6 秒等页面把会话行渲染出来再走下一轮，
                  // 最多 8 轮。不停顿地一直点会让应用一直处在新工作区的加载中，永远看不到会话行。
                  'function pickWorkspace(){',
                  'if(rowsVisible()<1)return;',
                  'var k=d.querySelectorAll(\'[data-row-key^="workspace:"]\');',
                  'if(!k.length)return;',
                  'var now=Date.now();',
                  'if((window.__fpWsPass||0)>8)return;',
                  'if(window.__fpWsWaitUntil&&now<window.__fpWsWaitUntil)return;',
                  'window.__fpWsIdx=window.__fpWsIdx||0;',
                  'if(window.__fpWsIdx>=k.length){',
                  'window.__fpWsIdx=0;',
                  'window.__fpWsPass=(window.__fpWsPass||0)+1;',
                  'window.__fpWsWaitUntil=now+6000;',
                  'return;',
                  '}',
                  'if(window.__fpWsAt&&now-window.__fpWsAt<700)return;',
                  'window.__fpWsAt=now;',
                  'var wi=window.__fpWsIdx;',
                  'window.__fpWsIdx=wi+1;',
                  'hardClick(k[wi]);',
                  '}',
                  // 窄窗口下会话列表是折叠的：DOM 里只有 workspace:* 分组行，没有 session:* 行。
                  // 以前只点一次"打开侧边栏"就傻等，所以永远找不到行、永远停在欢迎页。
                  // 这里把每个分组行都点开（aria-expanded 已是 true 的跳过），行才会出现。
                  'var expandedAt={};',
                  'function expandWorkspaces(){',
                  'var k=d.querySelectorAll(\'[data-row-key^="workspace:"]\');',
                  'var now=Date.now();var did=0;',
                  'for(var i=0;i<k.length&&did<4;i++){',
                  'var el=k[i];var key=String(el.getAttribute("data-row-key"));',
                  'if(el.getAttribute("aria-expanded")==="true")continue;',
                  'if(expandedAt[key]&&now-expandedAt[key]<9000)continue;',
                  'expandedAt[key]=now;did++;',
                  // 工作区分组行也只认指针序列（el.click() 在抽屉里点不动）。
                  'hardClick(el);',
                  '}',
                  '}',
                  // 侧栏行现在是不是真的可见（抽屉收起来时它们是 0×0）。
                  'function rowsVisible(){',
                  'var k=d.querySelectorAll("[data-row-key]");var v=0;',
                  'for(var i=0;i<k.length;i++){try{var r=k[i].getBoundingClientRect();if(r.width>8&&r.height>8){v++;if(v>2)return v}}catch(e){}}',
                  'return v;',
                  '}',
                  // 光有编辑框不算进到会话里：首页新会话视图也有编辑框，
                  // 以前就是在这里误判成功、然后再也不点行。要求"有编辑框 + 确实在会话里"。
                  // 消息块计数是全文档属性子串扫描，长会话里一次就是几千个节点；
                  // 600ms 内复用上一次的结果（判据本身不需要 250ms 的精度）。
                  'function inThread(){',
                  // 最硬的判据：这一页的标题就是目标会话的名字（副本会把标题同步成会话名）。
                  'if(TITLE&&String(d.title||"").indexOf(TITLE)>=0)return true;',
                  'var nowTh=Date.now();',
                  'if(window.__fpThAt&&nowTh-window.__fpThAt<600)return window.__fpTh;',
                  'window.__fpThAt=nowTh;',
                  'var outTh=false;',
                  'try{',
                  // 先排掉欢迎页：新会话视图也有编辑框、也有一堆卡片，但它不是会话。
                  'var ccTh=d.querySelector(\'[class*="centerCol"]\');',
                  'var txTh=String((ccTh&&ccTh.textContent)||"");',
                  'var m=(ccTh||d).querySelectorAll("[class*=msg],[class*=turn]");',
                  'if(m.length>1)outTh=true;',
                  'else if(ccTh&&d.querySelectorAll("[class*=msg],[class*=turn]").length>1)outTh=true;',
                  // 欢迎页判据只在「几乎没有消息块」时才有意义：输入框占位符本身就常写着
                  // 「开始新的对话」，拿它当否决条件会把真会话也判成欢迎页（tries 跑满也不 ok）。
                  'else if(txTh&&/up next|选择工作区|查看工作区/.test(txTh))outTh=false;',
                  '}catch(eTh){outTh=false}',
                  'window.__fpTh=outTh;',
                  'return outTh;',
                  '}',
                  // 窄窗口里宿主把左栏收成抽屉，抽屉没拉开时工作区/会话行根本不在 DOM 里，
                  // 于是 sessionRow() 永远是空、导航永远不生效。所以要反复试着拉开。
                  'var sideTries=0;',
                  // 合成点击：宿主的行不是 <button>，只派发 click 有时不认，
                  // 按真实指针顺序补齐（pointerdown → mousedown → pointerup → mouseup → click）。
                  'function hardClick(el){',
                  'if(!el)return;',
                  'try{el.scrollIntoView({block:"nearest"})}catch(e1){}',
                  'var r=null;try{r=el.getBoundingClientRect()}catch(e2){}',
                  'var opt={bubbles:true,cancelable:true,composed:true,view:window,button:0,detail:1,buttons:1,isPrimary:true,pointerType:"mouse"};',
                  'if(r){opt.clientX=r.left+r.width/2;opt.clientY=r.top+r.height/2;}',
                  'try{el.dispatchEvent(new PointerEvent("pointerdown",opt))}catch(e3){}',
                  'try{el.dispatchEvent(new MouseEvent("mousedown",opt))}catch(e4){}',
                  'try{el.dispatchEvent(new PointerEvent("pointerup",opt))}catch(e5){}',
                  'try{el.dispatchEvent(new MouseEvent("mouseup",opt))}catch(e6){}',
                  'try{el.click()}catch(e7){}',
                  '}',
                  'function openSidebar(){',
                  'var all=d.querySelectorAll("button,[role=button]");',
                  'var first=null;',
                  'for(var i=0;i<all.length;i++){',
                  'var el=all[i];',
                  'var lab=String((el.getAttribute("aria-label")||"")+" "+(el.getAttribute("title")||"")).trim();',
                  'if(!lab)continue;',
                  // 「收起侧边栏」是反方向的按钮，点了会把侧栏关掉——千万别点。
                  'if(/收起|关闭|折叠|collapse|close/i.test(lab))continue;',
                  'if(/打开侧边栏|打开侧栏|展开侧边|打开菜单|显示侧边|open sidebar/i.test(lab)){hardClick(el);return;}',
                  'if(!first&&/侧栏|侧边|菜单|sidebar|menu|sessions/i.test(lab))first=el;',
                  '}',
                  'if(first)hardClick(first);',
                  '}',
                  'function openSession(){',
                  'if(!SID||ok)return;',
                  'fetchTitle();',
                  // 一次性把侧栏里的行结构 dump 出来：到底有没有会话行、工作区行怎么展开。
                  'if(!window.__fpDump){window.__fpDump=1;try{',
                  'var rr=d.querySelectorAll("[data-row-key]");var arr=[];',
                  'for(var ri=0;ri<rr.length&&ri<10;ri++){',
                  'arr.push({k:String(rr[ri].getAttribute("data-row-key")).slice(0,26),e:rr[ri].getAttribute("aria-expanded"),tag:rr[ri].tagName,c:rr[ri].querySelectorAll("button,[role=button]").length,x:String(rr[ri].textContent||"").replace(/\\s+/g," ").trim().slice(0,22)});',
                  '}',
                  'plog("rows",{n:rr.length,arr:arr});',
                  '}catch(e){plog("rows-err",{m:String(e&&e.message||e)})}}',
                  // 窄窗口里侧栏收成抽屉、行不挂载时，把顶栏按钮的 label 全 dump 一次，
                  // 好确认「打开侧栏」这个入口到底叫什么。
                  'if(!window.__fpBtnDump&&tries>44){window.__fpBtnDump=1;try{',
                  'var bb=d.querySelectorAll("button,[role=button]");var bs=[];',
                  'for(var bi=0;bi<bb.length&&bi<40;bi++){',
                  'var be=bb[bi];bs.push({l:String(be.getAttribute("aria-label")||"").slice(0,18),t:String(be.getAttribute("title")||"").slice(0,18),x:String(be.textContent||"").trim().slice(0,12),c:String(be.className||"").slice(0,26)});',
                  '}',
                  'var sbEl=d.querySelector("[data-sidebar-collapsed],[data-sidebar-drawer]");',
                  'plog("btns",{n:bb.length,arr:bs,sb:sbEl?String(sbEl.outerHTML).slice(0,900):""});',
                  '}catch(e2){plog("btns-err",{m:String(e2&&e2.message||e2)})}}',
                  'if(tries%4===0){var r0=sessionRow()||titleRow();var sb=d.querySelector("[data-sidebar-collapsed],[data-sidebar-drawer]");plog("nav",{tries:tries,row:!!r0,keys:d.querySelectorAll("[data-row-key]").length,sb:sb?String(sb.getAttribute("data-sidebar-collapsed")||sb.getAttribute("data-sidebar-drawer")).slice(0,12):"",t:String(TITLE).slice(0,24),thread:inThread(),cc:hasComposer(),ms:d.querySelectorAll("[class*=msg],[class*=message],[class*=turn]").length,dt:String(d.title||"").slice(0,28)});}',
                  'if(hasComposer()&&inThread()){ok=true;return;}',
                  'if(tries++>400)return;',
                  // 点了很久还是挑不出「已选中」，但编辑框已经在：说明宿主用的是别的
                  // 选中标记。这时候认了——顶多是侧栏晚点收起来，不能一直不收。
                  'if(tries>60&&hasComposer()&&inThread()){ok=true;return;}',
                  'var row=sessionRow()||titleRow();',
                  // 行存在但躺在收起来的抽屉里（窄窗口）时点它没用，得先把抽屉拉开。
                  'var rowHidden=false;',
                  'if(row){try{var rb=row.getBoundingClientRect();rowHidden=(rb.width<4||rb.height<4);}catch(eRb){}}',
                  'if(!row||rowHidden){',
                  // 抽屉开着的时候再点一次「打开侧边栏」会把它重新关上，于是来回翻：
                  // 所以先看行是否已经可见，只有真收着才点，而且 700ms 内只点一次。
                  'if(rowsVisible()<1&&sideTries<40&&tries%3===0&&Date.now()-(window.__fpSideAt||0)>700){window.__fpSideAt=Date.now();sideTries++;openSidebar();}',
                  'if(tries%2===0)expandWorkspaces();',
                  'else pickWorkspace();',
                  'if(!row)return;',
                  '}',
                  'hardClick(row);',
                  // 有的行只认键盘：焦点给到它再敲个回车。
                  'if(tries%2===0){try{var inner=row.querySelector("button,a,[role=button],[tabindex]");if(inner&&inner!==row)hardClick(inner);else{row.focus&&row.focus();row.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true}));}}catch(eK){}}',
                  '}',
                  // 面板模式：找到并点开指定面板（按可见文字匹配），再把面板容器铺满视口。
                  'var panelDone=false;',
                  'var panelTries=0;',
                  'function findButton(text){',
                  'var all=d.querySelectorAll("button,a,[role=button]");',
                  'for(var i=0;i<all.length;i++){',
                  'var t=(all[i].textContent||"").replace(/\\s+/g," ").trim();',
                  'if(!t)continue;',
                  'if(t===text||t.indexOf(text)===0)return all[i];',
                  '}',
                  'return null;',
                  '}',
                  'function openPanel(){',
                  'if(!PANEL||panelDone)return;',
                  'var pbb=d.querySelector(\'[class*="panelBody"]\');',
                  'if(pbb&&pbb.getBoundingClientRect().height>120){panelDone=true;return;}',
                  'if(panelTries++>30)return;',
                  'var b=findButton(PANEL);',
                  'if(!b){if(panelTries%6===0)plog("panel-no-btn",{want:PANEL,n:panelTries});return;}',
                  'hardClick(b);',
                  'if(panelTries%4===0)plog("panel-click",{want:PANEL,n:panelTries,cls:String(b.className||"")});',
                  '}',
                  'function hideCenter(){',
                  'if(!PANEL)return;',
                  'var c=d.querySelector(\'[class*="centerCol"]\');',
                  'if(c&&c.style.display!=="none")c.style.display="none";',
                  '}',
                  'function fitPanel(){',
                  'if(!PANEL||!panelDone)return;',
                  'var tl=d.querySelector(\'[class*="tabLayout"]\');',
                  'if(!tl)return;',
                  'var host=tl;',
                  'for(var i=0;i<3&&host.parentElement&&host.parentElement!==d.body;i++)host=host.parentElement;',
                  'if(host.getAttribute("data-fp-fit")==="1")return;',
                  'host.setAttribute("data-fp-fit","1");',
                  'var st=host.style;',
                  'st.setProperty("position","fixed","important");',
                  'st.setProperty("left","0","important");',
                  'st.setProperty("top","0","important");',
                  'st.setProperty("right","0","important");',
                  'st.setProperty("bottom","0","important");',
                  'st.setProperty("width","auto","important");',
                  'st.setProperty("height","auto","important");',
                  'st.setProperty("max-width","none","important");',
                  'st.setProperty("max-height","none","important");',
                  'st.setProperty("margin","0","important");',
                  'st.setProperty("z-index","2","important");',
                  '}',
                  'function visibleTab(){',
                  'var els=d.querySelectorAll(\'[class*="tabLayout"]\');',
                  'for(var i=0;i<els.length;i++){if(els[i].offsetWidth>200&&els[i].offsetHeight>200)return els[i];}',
                  'return null;',
                  '}',
                  'function collapseEmptyPanes(){',
                  'var cells=d.querySelectorAll(\'[class*="tabCell"]\');',
                  'for(var i=0;i<cells.length;i++){',
                  'var el=cells[i];',
                  'var r=el.getBoundingClientRect();',
                  'if(r.height<2||r.width<2){',
                  'if(el.style.display!=="none")el.style.display="none";',
                  '}else if(el.style.display==="none"){el.style.display="";}',
                  '}',
                  '}',
                  // 右栏留在那儿会把中间那一列挤成一半（纯净对话就只要中间）。
                  'function hideRightColumn(){',
                  'var c=d.querySelector(\'[class*="centerCol"]\');',
                  'if(!c||!c.parentElement)return;',
                  'var cr=c.getBoundingClientRect();',
                  // centerCol 一旦被拉成满宽，右栏的 left 就再也不会 >= cr.right，
                  // 所以除了「贴右边」还要认两种证据：里面有面板本体，或者整体落在右半屏。
                  'var mid=cr.left+cr.width*0.58;',
                  'var k=c.parentElement.children;',
                  'for(var i=0;i<k.length;i++){',
                  'var el=k[i];',
                  'if(el===c||el.nodeType!==1)continue;',
                  'if(el.getAttribute("data-fp-keep")==="1")continue;',
                  'var r=el.getBoundingClientRect();',
                  'if(r.width<12)continue;',
                  'var hasPanel=false;',
                  'try{hasPanel=!!el.querySelector(\'[class*="panelBody"],[class*="tabHost"]\');}catch(e){}',
                  'if(hasPanel||r.left>=cr.right-40||r.left>=mid){',
                  'if(el.style.display!=="none")el.style.display="none";',
                  '}',
                  '}',
                  '}',
                  // 会话头部右侧那排小按钮（列表 / 更多 / 展开）在纯对话里没有意义，
                  // 但它们不在消息块内、也没有稳定类名，所以按几何收拾：落中间列顶部、
                  // 边长不超过 48px 的按钮一律隐藏。
                  'function hideHeaderActions(){',
                  'var c=d.querySelector(\'[class*="centerCol"]\');',
                  'if(!c)return;',
                  'var cr=c.getBoundingClientRect();',
                  'var all=c.querySelectorAll("button,[role=button]");',
                  'for(var i=0;i<all.length;i++){',
                  'var el=all[i];',
                  'if(el.getAttribute("data-fp-keep")==="1")continue;',
                  'var r=el.getBoundingClientRect();',
                  'if(r.width<4||r.height<4)continue;',
                  'if(r.width>64||r.height>64)continue;',
                  'if(r.top>cr.top+124)continue;',
                  'if(el.style.display!=="none")el.style.display="none";',
                  'el.setAttribute("data-fp-hidden","1");',
                  '}',
                  // 那三个按钮未必是 <button>：也可能是图标 div。中间列顶部、
                  // 没有可见文字、尺寸又小的块，只要不装着正文，就一起收掉。
                  'var blocks=c.querySelectorAll("div,span,a");',
                  'for(var j=0;j<blocks.length;j++){',
                  'var b=blocks[j];',
                  'if(b.getAttribute("data-fp-keep")==="1")continue;',
                  'if(b.getAttribute("data-fp-hidden")==="1")continue;',
                  'var br=b.getBoundingClientRect();',
                  'if(br.width<4||br.height<6)continue;',
                  'if(br.width>120||br.height>64)continue;',
                  'if(br.top>cr.top+124)continue;',
                  'var tx=(b.textContent||"").replace(/\\s+/g,"");',
                  'if(tx.length>6)continue;',
                  'if(b.querySelector("textarea,input,[contenteditable]"))continue;',
                  'if(b.querySelector("button,[role=button]")&&tx.length===0&&b.children.length<=12){',
                  'b.style.display="none";',
                  'b.setAttribute("data-fp-hidden","1");',
                  '}',
                  '}',
                  '}',
                  // 把「每个回复右边那三个按钮」的真实类名探出来：注入的 CSS 靠猜类名，
                  // 猜不中就永远藏不掉，所以先让页面自己报一次结构。
                  'var AUDITED=false;',
                  'function plog(name,obj){',
                  'try{fetch("/_dsh/dsh-free-pane/log",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,extra:obj})});}catch(e){}',
                  '}',
                  // 对接协议 v1（画布 → 副本）：画布把一块结构化数据 postMessage 进来，
                  // 这里转成 CustomEvent 给副本里的脚本用，并存一份在 sessionStorage。
                  'window.addEventListener("message",function(evBridge){',
                  'var db=evBridge&&evBridge.data;',
                  // 画布要「计数表 / 小鲸鱼」那类只长在对话里的东西：画布占了主区时宿主
                  // 根本不渲染它们，只能由副本自己找出来回传（跨 origin 也能走 postMessage）。
                  'if(db&&db.fp==="stats"){',
                  'var sEl=null;',
                  // 注意：不能用逗号选择器一次 querySelector —— 它返回文档顺序里第一个命中的，
                  // 而 composer-dock 是 stats 的祖先、更靠前，结果整条 dock（带横幅）都会被搬走。
                  'try{',
                  'var sSels=["[class*=dsh-claude-inline-stats]","[class*=inline-stats]","[data-dsh-claude-part=composer-dock]","[data-composer-dock]"];',
                  'sEl=null;',
                  'for(var sI=0;sI<sSels.length;sI++){',
                  'var sC=d.querySelector(sSels[sI]);',
                  'if(!sC)continue;',
                  'var sCR=sC.getBoundingClientRect();',
                  'if(sCR.width>=30&&sCR.height>=8){sEl=sC;break}',
                  '}',
                  '}catch(eSt1){sEl=null}',
                  'if(sEl){',
                  // 复制前先把「在副本里其实看不见」的后代标出来（display:none / 0 尺寸）。
                  // 克隆丢了样式表之后它们会变成正文，把真正要看的数字挤没。
                  'try{',
                  'var sAll=sEl.querySelectorAll("*");',
                  'for(var sA=0;sA<sAll.length;sA++){',
                  'var sAR=sAll[sA].getBoundingClientRect();',
                  'if(sAR.width<1&&sAR.height<1)sAll[sA].setAttribute("data-fp-hid","1");',
                  '}',
                  '}catch(eStHide){}',
                  'var sClone=sEl.cloneNode(true);',
                  'sClone.removeAttribute("style");',
                  'var sDeep=sClone.querySelectorAll("*");',
                  'for(var si=0;si<sDeep.length;si++){var sv=sDeep[si];var ss=String((sv.getAttribute&&sv.getAttribute("style"))||"");if(/position\\s*:\\s*(fixed|absolute)/i.test(ss))sv.style.position="static";if(/inset\\s*:/i.test(ss))sv.style.inset="auto";if(/transform\\s*:/i.test(ss))sv.style.transform="none";}',
                  'var sGhost=sClone.querySelectorAll("[data-fp-hid]");',
                  'for(var sG=0;sG<sGhost.length;sG++){if(sGhost[sG].parentNode)sGhost[sG].parentNode.removeChild(sGhost[sG]);}',
                  'var sR=sEl.getBoundingClientRect();',
                  'try{plog("stats-pick",{cls:String(sEl.className||"").slice(0,72),w:Math.round(sR.width),h:Math.round(sR.height),len:sClone.outerHTML.length});}catch(eSt3){}',
                  'var sParts=[];',
                  'try{var sLeaves=sEl.querySelectorAll("*");for(var sL=0;sL<sLeaves.length;sL++){var sLN=sLeaves[sL];if(sLN.children&&sLN.children.length)continue;var sLT=String(sLN.innerText||sLN.textContent||"").replace(/\\s+/g," ").trim();if(sLT)sParts.push(sLT);}}catch(eStParts){}',
                  'var sText=sParts.length?sParts.join(" · "):String(sEl.innerText||sEl.textContent||"").replace(/\\s+/g," ").trim();',
                  'try{window.parent.postMessage({fp:"stats-reply",sid:SID,html:sClone.outerHTML,text:sText.slice(0,240),w:Math.round(sR.width),h:Math.round(sR.height)},"*");}catch(eSt2){}',
                  '}',
                  'return;',
                  '}',
                  'if(!db||db.fp!=="bridge")return;',
                  'try{SS&&SS.setItem("fp.bridge.last",JSON.stringify(db));}catch(eB1){}',
                  'try{window.dispatchEvent(new CustomEvent("fp:bridge",{detail:db}));}catch(eB2){}',
                  'var ebSid=db.payload&&db.payload.sessionId?String(db.payload.sessionId):"";',
                  'plog("bridge-in",{v:db.v,channel:String(db.channel||""),sid:ebSid.slice(-8)});',
                  'if(ebSid&&String(EMBED).indexOf("panel")===0){SID=ebSid;ok=false;window.__fpNavDone=0;}',
                  '});',
                  // 完整界面里右栏「展开着但里面什么都没有」时收掉它；有内容就留着。
                  'function tidyRightbar(){',
                  'try{',
                  'var rc=d.querySelectorAll("[class*=rightbarCol],[class*=rightbar-col]");',
                  'for(var ri=0;ri<rc.length;ri++){',
                  'var rEl=rc[ri];',
                  'var has=rEl.querySelector("[class*=tabHost],[class*=panelBody]");',
                  'var want=has?"":"none";',
                  'if(rEl.style.display!==want)rEl.style.display=want;',
                  '}',
                  '}catch(eRB){}',
                  '}',
                  'function desc(el){',
                  'var a=[String(el.className||""),String(el.getAttribute("aria-label")||""),String(el.getAttribute("title")||""),String(el.getAttribute("data-testid")||"")];',
                  'return a.join(" | ");',
                  '}',
                  'function auditMsg(){',
                  'var out=[];',
                  'var seen={};',
                  'var btns=d.querySelectorAll("button");',
                  'for(var i=0;i<btns.length&&out.length<14;i++){',
                  'var b=btns[i];',
                  'var r=b.getBoundingClientRect();',
                  'if(r.width<8||r.height<8)continue;',
                  'var dsc=desc(b);',
                  'if(seen[dsc])continue;',
                  'seen[dsc]=1;',
                  'var chain=[];',
                  'var p=b.parentElement;',
                  'for(var j=0;j<4&&p;j++){chain.push(String(p.className||p.tagName||""));p=p.parentElement;}',
                  'out.push({b:dsc,w:Math.round(r.width),h:Math.round(r.height),chain:chain});',
                  '}',
                  'plog("msg-audit",{buttons:out});',
                  '}',
                  'function disableSideButtons(){',
                  'var all=d.querySelectorAll("button,[role=button]");',
                  'for(var i=0;i<all.length;i++){',
                  'var el=all[i];',
                  'var lab=String((el.getAttribute("aria-label")||"")+" "+(el.getAttribute("title")||""));',
                  'if(/侧栏|侧边栏|展开侧边|sidebar|toggle side/i.test(lab)){',
                  'if(!el.disabled){el.disabled=true;}',
                  'el.style.opacity="0.35";',
                  'el.style.cursor="default";',
                  '}',
                  '}',
                  '}',
                  'function hideDecor(){',
                  // 副本里不该出现挂件类的东西：报价小鲸鱼、宠物、吐司、浮提示。
                  // CSS 已经写了同样的规则，这里是兜底（有些挂件是后插入、还带内联定位）。
                  'var sel="[class*=dshwv],[class*=whale],[class*=Whale],[id*=whale],[class*=nekowhale],[class*=toast],[class*=Toast]";',
                  'var list=d.querySelectorAll(sel);',
                  'for(var i=0;i<list.length;i++){',
                  'var el=list[i];',
                  'if(el.closest&&el.closest("[class*=centerCol]"))continue;',
                  'if(el.style.getPropertyValue("display")!=="none")el.style.setProperty("display","none","important");',
                  '}',
                  '}',
                  'function toParent(obj){try{obj.href=String(location.href).slice(-80);window.parent.postMessage({fp:1,d:obj},"*")}catch(eP){}}',
                  // 推理「右边白边」用：报副本自己每一层的实际宽度与限制来源。
                  'function geo(){try{',
                  'function pick(sel){var e=d.querySelector(sel);if(!e)return null;var r=e.getBoundingClientRect();var s=window.getComputedStyle(e);return{w:Math.round(r.width),mw:s.maxWidth,pl:s.paddingLeft,pr:s.paddingRight,ml:s.marginLeft,mr:s.marginRight,dp:s.display}}',
                  'return{iw:Math.round(window.innerWidth),z:String(d.documentElement.style.zoom||""),',
                  'bw:d.body?Math.round(d.body.getBoundingClientRect().width):0,',
                  'ccw:pick("[class*=centerCol]"),view:pick("[class*=viewArea]"),sb:pick("[class*=scrollBody]"),col:pick("[class*=column]")',
                  '}}catch(eG){return{}}}',
                  'function tick(){try{tickBody();try{window.__fpN=(window.__fpN||0)+1;if(window.__fpN%5===0){var g=geo();g.n=window.__fpN;g.cc=(typeof hasComposer==="function"?hasComposer():-1);g.th=(typeof inThread==="function"?inThread():-1);g.keys=d.querySelectorAll("[data-row-key]").length;g.dt=String(d.title||"").slice(0,40);toParent(g)};if(window.__fpN%20===0)plog("hb",{n:window.__fpN,cc:(typeof hasComposer==="function"?hasComposer():-1),th:(typeof inThread==="function"?inThread():-1),keys:d.querySelectorAll("[data-row-key]").length});}catch(eH){}}catch(e){if(!window.__fpTickErr){window.__fpTickErr=1;plog("tick-error",{msg:String((e&&e.message)||e)})}}}',
                  'function widen(){',
                  // 副本里对话列常常被 max-width / auto margin 框在中间，宽窗里就成了一条
                  // 「右边一大块白」。从消息列往上走，把每一层的宽度限制拆掉。
                  'try{',
                  'var col=d.querySelector("[class*=column]");if(!col)return;',
                  'var p=col;var i=0;',
                  'while(p&&i<7){',
                  'if(p!==d.body&&p!==d.documentElement){',
                  'if(p.style.maxWidth!=="none")p.style.maxWidth="none";',
                  'if(p.style.minWidth&&p.style.minWidth!=="0px")p.style.minWidth="0px";',
                  'if(p.style.marginLeft)p.style.marginLeft="0";',
                  'if(p.style.marginRight)p.style.marginRight="0";',
                  '}',
                  'p=p.parentElement;i+=1;',
                  '}',
                  'if(!window.__fpWidenSeen){window.__fpWidenSeen=1;plog("widen",{iw:Math.round(window.innerWidth),col:Math.round(col.getBoundingClientRect().width)})}',
                  '}catch(eW){}',
                  '}',
                  'function closeDetails(){',
                  'try{',
                  'var b=d.querySelector("button.dsh-claude-session-panel-button");',
                  'if(!b)return;',
                  'if(String(b.getAttribute("aria-pressed"))!=="true")return;',
                  'hardClick(b);',
                  '}catch(eC){}',
                  '}',
                  'function tickBody(){',
                  'if(!window.__fpTickSeen){window.__fpTickSeen=1;plog("tick-started",{embed:String(EMBED),sid:String(SID||"").slice(0,14)})}',
                  // 分频：导航判据要 250ms 的精度（点了行要马上知道成了没有），
                  // 但「收挂件 / 拆宽度限制 / 收空面板 / 裁右侧白边」全都要读几何甚至全文档扫描，
                  // 每 250ms 来一遍会在客户端自己挂载 React 的时候抢主线程（首屏正是最吃 CPU 的 20 秒）。
                  // 这些装饰性的一次/慢速做就够了：4 个 tick（1 秒）一次。
                  'var HVY=(window.__fpN%4===0);',
                  'ensureStyle();',
                  'if(HVY||!window.__fpDecorOnce){window.__fpDecorOnce=1;hideDecor();}',
                  // 对话（或面板）真的画出来了就揭幕；兜底 140 个 tick 也揭，避免永远糊着。
                  'try{if(HVY&&!window.__fpVeilOff){var vmN=(d.querySelector("[class*=centerCol]")||d).querySelectorAll("[class*=msg],[class*=turn]").length;var vpN=String(EMBED).indexOf("panel")===0;if(vmN>1||(vpN&&window.__fpN>12)||window.__fpN>60){window.__fpVeilOff=1;dropVeil()}}}catch(eV2){}',
                  'try{if(HVY&&String(EMBED).indexOf("panel")!==0)widen()}catch(eW2){}',
                  // 副本不再自己按宽度缩放：缩放交给窗口上的 −/+（元素级），
                  // 两边都缩会叠成「内容变小 + 右边留白」。
                  'try{if(String(EMBED).indexOf("panel")!==0&&d.documentElement.style.zoom)d.documentElement.style.zoom=""}catch(eZ){}',
                  'try{if(String(EMBED).indexOf("panel")!==0&&window.__fpN%4===0)closeDetails()}catch(eW3){}',
'if(!window.__fpKeys){window.__fpKeys=1;try{var ks=[];var kn=d.querySelectorAll("[data-row-key],[data-session-id]");for(var ki=0;ki<kn.length&&ki<8;ki++){ks.push(String(kn[ki].getAttribute("data-row-key")||kn[ki].getAttribute("data-session-id")||"").slice(0,50))}plog("keys",{n:kn.length,ks:ks})}catch(e){}}',
                  // 完整界面（fpEmbed=off）：布局一点不动，只把挂件收掉、把自己导航进目标会话。
                  'if(EMBED==="off"){hideBodyLayers();tidyRightbar();openSession();return;}',
                  'if(PANEL){openPanel();return;}',
                  // 面板模式只留右栏：不能把 centerCol 的兄弟节点全隐藏（右栏也是它的兄弟）。
                  'if(EMBED.indexOf("panel:")===0){hideBodyLayers();if(HVY)collapseEmptyPanes();soloPanel();return;}',
                  'hideBodyLayers();',
                  'if(HVY)collapseEmptyPanes();',
                  // 副本会从 localStorage 恢复上次选的面板（通常是「自由窗格」自己），
                  // 而那个类型在副本里没注册 → 只剩一句「这类内容还没有可用的查看方式」。
                  // 所以先点一下侧栏的「会话」，把主面板切回内置对话。
                  'if(EMBED==="pure"&&SID&&!window.__fpNavDone){var nb0=findButton("会话");if(nb0){try{nb0.click();window.__fpNavDone=1}catch(e){}}}',
                  // 侧栏一旦先藏掉，行就不在 DOM 里，永远点不到（以前就卡在这）。
                  'openSession();',
                  'if(!SID||ok)hideSiblings();',
                  // 纯净模式：进了会话就把左栏收掉（CSS 里 html[data-fp-ok] 那条规则），
                  // 卡片里只剩对话本体 —— 否则一张 426px 的卡还会被 190px 的侧栏切走一半。
                  'try{if(ok&&EMBED==="pure"&&!d.documentElement.hasAttribute("data-fp-ok"))d.documentElement.setAttribute("data-fp-ok","1")}catch(eOk){}',
                  // 右栏不用等：纯净对话只要中间那一列，右栏留着就会把对话挤成一半。
                  'hideRightColumn();',
                  // 一次性把副本的实际布局报回宿主，免得靠截图猜（见 %TEMP%\dsh-free-pane-trace.log）。
                  'if(EMBED==="pure"&&!window.__fpState){window.__fpState=1;setTimeout(function(){try{',
                  'var cc=d.querySelector("[class*=centerCol]");var box=[];',
                  'if(cc&&cc.parentElement){var kids=cc.parentElement.children;for(var i=0;i<kids.length;i++){var e2=kids[i];if(e2.nodeType!==1)continue;var r2=e2.getBoundingClientRect();box.push({c:String(e2.className||"").slice(0,40),w:Math.round(r2.width),l:Math.round(r2.left),vis:e2.style.display!=="none"})}}',
                  'fetch("/_dsh/dsh-free-pane/log",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"embed-state",t:Date.now(),sid:String(SID||""),ok:ok,tries:tries,row:!!sessionRow(),hasCc:!!cc,panels:d.querySelectorAll("[class*=panelBody]").length,tabs:d.querySelectorAll("[class*=tabHost]").length,rows:(function(){var o=[];var r=d.querySelectorAll("[data-row-key]");for(var i=0;i<r.length&&i<10;i++)o.push(String(r[i].getAttribute("data-row-key")).slice(0,50));return o})(),btns:(function(){var o=[];var r=d.querySelectorAll("button,[role=button]");for(var i=0;i<r.length&&i<26;i++){var l=String((r[i].getAttribute("aria-label")||"")+"|"+(r[i].getAttribute("title")||"")+"|"+(r[i].textContent||"").replace(/\\s+/g," ").trim()).slice(0,44);if(l!=="||")o.push(l)}return o})(),hdr:(function(){var c2=d.querySelector("[class*=centerCol]");var o2=[];if(c2){var cr2=c2.getBoundingClientRect();var bb=c2.querySelectorAll("button,[role=button]");for(var i=0;i<bb.length&&o2.length<24;i++){var r3=bb[i].getBoundingClientRect();if(r3.top>cr2.top+124)continue;o2.push({l:String((bb[i].getAttribute("aria-label")||"")+"|"+(bb[i].getAttribute("title")||"")+"|"+(bb[i].textContent||"").replace(/\\s+/g," ").trim()).slice(0,32),c:String(bb[i].className||"").slice(0,28),w:Math.round(r3.width),h:Math.round(r3.height),hid:bb[i].style.display==="none"})}}return o2})(),box:box})})',
                  '}catch(e){}},7000)}',
                  // 侧栏已经藏了，那个「呼出侧栏」的按钮点了也不会有反应——直接禁用，
                  // 免得用户以为坏了。
                  'if(!SID||ok)disableSideButtons();',
                  // 副本里除了我们自己藏掉的右栏，还常有「收起来的 dockkit 导轨」这类
                  // 横在中间列右侧的残留（宽 40~300、里面几乎没内容），在大窗里就是一条
                  // 大白边。这里按几何位置收：凡是完全落在中间列右侧、且有点宽高的兄弟块，
                  // 一律藏掉，不管它叫什么类名。
                  'function trimRight(){',
                  'var cc=d.querySelector("[class*=centerCol]");',
                  'if(!cc)return;',
                  'var cr=cc.getBoundingClientRect();',
                  'if(!cr.width)return;',
                  'var node=cc;',
                  'for(var lv=0;lv<3&&node&&node.parentElement;lv++){',
                  'var kids=node.parentElement.children;',
                  'for(var i=0;i<kids.length;i++){',
                  'var ke=kids[i];',
                  'if(ke===node)continue;',
                  'if(ke.getAttribute("data-fp-trim")==="1")continue;',
                  'var kr=ke.getBoundingClientRect();',
                  'if(kr.width>=10&&kr.height>=40&&kr.left>=cr.right-6){',
                  'ke.setAttribute("data-fp-trim","1");',
                  'ke.style.setProperty("display","none","important");',
                  'plog("trim-right",{cls:String(ke.className||"").slice(0,50),w:Math.round(kr.width),x:Math.round(kr.left)});',
                  '}',
                  '}',
                  'node=node.parentElement;',
                  '}',
                  '}',
                  'if(EMBED==="pure")hideHeaderActions();',
                  'if(HVY&&EMBED!==""&&EMBED.indexOf("panel:")!==0)trimRight();',
                  'if(!SID||ok){if(!AUDITED){AUDITED=true;setTimeout(auditMsg,2500);}}',
                  '}',
                  'tick();',
                  // 首屏到底是哪一段在吃时间：一次性把导航计时与最慢的 8 个资源报回宿主。
                  'if(!window.__fpPerf){window.__fpPerf=1;setTimeout(function(){try{',
                  'var nav=(performance.getEntriesByType("navigation")[0])||{};',
                  'var rs=performance.getEntriesByType("resource").map(function(r){return{d:Math.round(r.duration),t:Math.round(r.startTime),n:String(r.name).split("/").pop().slice(0,44)}}).sort(function(a,b){return b.d-a.d}).slice(0,8);',
                  'plog("perf",{dom:Math.round(nav.domContentLoadedEventEnd||0),load:Math.round(nav.loadEventEnd||0),rs:rs});',
                  '}catch(eP){}},3000);}',
                  // 以前这里是「前 20 秒 250ms 一次，然后**再新建**一个 1.5s 的 interval」，
                  // 两个都不清理：一旦副本进不去目标会话，就永远每 tick 合成点击 → 导航 → 重载（tries 归零）→ 再点，
                  // 把 CPU 打满还看不见任何东西。现在改成：进到会话、或者判定放弃，就把定时器自己停掉。
                  'var n=0;var timer=null;var T0=Date.now();',
                  'function fpGiveUp(){',
                  'window.__fpGiveUp=1;',
                  // 放弃时把跨加载计数清零：否则这一页的「失败记账」会把后面每一次
                  // 重新打开都带进同一个早退分支（整个 origin 的会话卡一起遭殃）。
                  'try{if(SS)SS.setItem("fp.boot","0")}catch(eB9){}',
                  'plog("nav-giveup",{boot:window.__fpBoot||0,ms:Date.now()-T0,n:n});',
                  'try{var tip=d.createElement("div");',
                  'tip.textContent="会话没能自动打开，请在这个窗口里手动点一下左侧的会话";',
                  'tip.style.cssText="position:fixed;left:12px;bottom:14px;z-index:2147483000;padding:8px 12px;border-radius:9px;background:rgba(20,20,22,.88);color:#fff;font:12px/1.5 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";',
                  'd.body.appendChild(tip);',
                  'var tk=setTimeout(function(){try{tip.remove()}catch(eR){}},9000);',
                  '}catch(eT){}}',
                  'function fpWelcomeTip(){',
                  'if(window.__fpWelcomeTip)return;window.__fpWelcomeTip=1;',
                  'try{var tip=d.createElement("div");tip.className="fp-welcome-tip";',
                  'tip.textContent="这个窗口停在宿主欢迎页：左侧只列工作区、没有会话行。请点左侧的会话（或工作区里的会话），也可以按 Ctrl+K 搜索会话。";',
                  'tip.style.cssText="position:fixed;left:12px;bottom:14px;z-index:2147483000;max-width:min(460px,calc(100vw - 24px));padding:8px 12px;border-radius:9px;background:rgba(20,20,22,.88);color:#fff;font:12px/1.5 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)";',
                  'd.body.appendChild(tip);}catch(eWT){}}',
                  'function loop(){',
                  'if(ok){if(timer){try{clearInterval(timer)}catch(eC){}timer=null;}',
                  'try{var wt=d.querySelector(".fp-welcome-tip");if(wt)wt.remove()}catch(eWT0){}',
                  'if(!window.__fpOkAt){window.__fpOkAt=Date.now();plog("nav-ok",{ms:window.__fpOkAt-T0,n:n,boot:window.__fpBoot||0});try{parent.postMessage({__fp:"ready",sid:String(SID||"")},"*")}catch(ePM){}}',
                  'try{if(SS)SS.setItem("fp.boot","0")}catch(eB0){}',
                  // 揭开揭幕布：以前它只在 tickBody 里按 HVY 判，而 loop 一看到
                  // ok 就直接 return，于是「对话已经画出来了、雾还糊在上面」永远散不掉。
                  'try{window.__fpVeilOff=1;dropVeil()}catch(eV1){}',
                  // ok 之后再做几拍收尾（把右栏/多余块收掉），拍完自己停。
                  'if(!window.__fpSettle){window.__fpSettle=1;var sk=0;var st=setInterval(function(){sk++;try{dropVeil();tickBody()}catch(eS0){}if(sk>=6){try{clearInterval(st)}catch(eS1){}}},600);}',
                  'return;}',
                  'if(window.__fpGiveUp){if(timer){try{clearInterval(timer)}catch(eC2){}timer=null;}return;}',
                  'if(!window.__fpBooted){window.__fpBooted=1;',
                  'try{var b=Number((SS&&SS.getItem("fp.boot"))||0)+1;window.__fpBoot=b;if(SS)SS.setItem("fp.boot",String(b));plog("boot",{b:b});}catch(eB){}',
                  '}',
                  'tick();n++;',
                  // 欢迎页的侧栏只列工作区、没有会话行：再点也点不出目标会话。
                  // 不装死，直接把「为什么没自动打开、要手动做什么」写到卡片里。
                  'if(SID&&!ok&&hasComposer()&&!inThread()&&Date.now()-T0>8000&&!sessionRow())fpWelcomeTip();',
                  // 这一页已经画出输入框 → 副本本身是健康的，把失败计数清掉，
                  // 别让某一次倒霉的加载把后面所有的会话卡都拖下水。
                  'if(hasComposer()){try{if(SS)SS.setItem("fp.boot","0")}catch(eB8){}}',
                  // 放弃判据（重写）：必须「这一页真的等够了」并且「之前已经反复重载过」。
                  // 原来是首 tick（250ms，客户端连壳都没画完）就按重载次数判死，于是第 4 次
                  // 之后的每次加载都立刻弹提示并永久停掉 loop —— 这就是「20–40 秒还停在兜底卡」。
                  'var el=Date.now()-T0;',
                  'if(el>18000&&(window.__fpBoot||0)>2&&!ok&&!hasComposer()&&!inThread()){fpGiveUp();return;}',
                  'if(n===80&&timer){try{clearInterval(timer)}catch(eD){}timer=setInterval(loop,1500);}',
                  '}',
                  'timer=setInterval(loop,250);',
                  '})();',
                ].join('\n')
                const script = '<script>\n' + embed + '\n</' + 'script>'
                body = body.indexOf('</body>') >= 0
                  ? body.replace('</body>', script + '</body>')
                  : body + script
                const buf = Buffer.from(body, 'utf8')
                delete out['content-length']
                out['content-length'] = String(buf.length)
                // 副本页不能吃缓存：同一串 ?autoSession=&fpEmbed= 会被浏览器记住，
                // 换了注入脚本以后仍然拿旧 HTML，表现就是「改了没反应」。
                out['cache-control'] = 'no-store, must-revalidate'
                delete out['etag']
                delete out['last-modified']
                try { res.writeHead(upRes.statusCode || 200, out) } catch (e) {}
                res.end(buf)
              } catch (e) {
                try { res.writeHead(500); res.end('inject failed') } catch (inner) {}
              }
            })
            return
          }
          try {
            res.writeHead(upRes.statusCode || 502, out)
          } catch (e) {}
          upRes.pipe(res)
        })
        up.on('error', function () {
          try {
            res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('free-pane proxy: upstream error')
          } catch (e) {}
        })
        req.on('error', function () {})
        req.pipe(up)
      } catch (e) {
        try {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('free-pane proxy failed')
        } catch (inner) {}
      }
}

function startProxies() {
  for (let i = 0; i < PROXY_COUNT; i += 1) startProxy(i)
}

function startProxy(slot) {
  const idx = Number(slot) || 0
  if (PROXY_SERVERS[idx]) return PROXY_PORTS[idx] || 0
  try {
    const srv = http.createServer(proxyHandler)
    srv.on('upgrade', function (req, socket, head) {
      try {
        const t = TARGET
        if (!t) {
          try { socket.destroy() } catch (e) {}
          return
        }
        const headers = Object.assign({}, req.headers)
        headers.host = t.host
        if (headers.origin) headers.origin = `${t.protocol}//${t.host}`
        if (PROXY_COOKIE) headers.cookie = PROXY_COOKIE
        const up = http.request({
          hostname: '127.0.0.1',
          port: t.port,
          path: req.url,
          method: req.method,
          headers,
        })
        up.on('upgrade', function (upRes, upSocket, upHead) {
          try {
            let raw = 'HTTP/1.1 101 Switching Protocols\r\n'
            for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
              raw += upRes.rawHeaders[i] + ': ' + upRes.rawHeaders[i + 1] + '\r\n'
            }
            socket.write(raw + '\r\n')
            if (upHead && upHead.length) socket.write(upHead)
            upSocket.pipe(socket)
            socket.pipe(upSocket)
            upSocket.on('error', function () { try { socket.destroy() } catch (e) {} })
            socket.on('error', function () { try { upSocket.destroy() } catch (e) {} })
            upSocket.on('close', function () { try { socket.destroy() } catch (e) {} })
            socket.on('close', function () { try { upSocket.destroy() } catch (e) {} })
          } catch (e) {
            try { socket.destroy() } catch (inner) {}
          }
        })
        up.on('response', function (res) {
          try {
            let raw = 'HTTP/1.1 ' + String(res.statusCode) + ' ' + String(res.statusMessage || 'Error') + '\r\n'
            for (let i = 0; i < res.rawHeaders.length; i += 2) {
              raw += res.rawHeaders[i] + ': ' + res.rawHeaders[i + 1] + '\r\n'
            }
            socket.write(raw + '\r\n')
            socket.end()
          } catch (e) {
            try { socket.destroy() } catch (inner) {}
          }
        })
        up.on('error', function () { try { socket.destroy() } catch (e) {} })
        up.end()
      } catch (e) {
        try { socket.destroy() } catch (inner) {}
      }
    })

    srv.on('clientError', function (err, socket) {
      try { socket.destroy() } catch (e) {}
    })
    srv.on('error', function () {})
    srv.listen(0, '127.0.0.1', function () {
      try {
        PROXY_PORTS[idx] = srv.address().port
        if (!PROXY_PORT) PROXY_PORT = PROXY_PORTS[idx] || 0
      } catch (e) {}
    })
    srv.unref()
    PROXY_SERVERS[idx] = srv
  } catch (e) {}
  return PROXY_PORTS[idx] || 0
}

// —— Office 预览：用宿主自带的 LibreOffice Kit 把 doc/docx/xls/xlsx/ppt/pptx 转成 PDF ——
// 右栏「文件」就是这样预览 Office 的；这里复用同一个引擎，文件卡不再只能让用户去系统里打开。
const OFFICE_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp'])
const OFFICE_CACHE = new Map()
const OFFICE_CACHE_MAX = 12
let OFFICE_CONVERTER = null
let OFFICE_LOADING = null

function findOfficeKitEntry() {
  const rel = ['app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'index.js']
  const roots = []
  try { if (process.resourcesPath) roots.push(process.resourcesPath) } catch (e0) {}
  try { roots.push(path.join(path.dirname(process.execPath), 'resources')) } catch (e1) {}
  try { if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources')) } catch (e2) {}
  for (const root of roots) {
    const file = path.join(root, ...rel)
    try { if (fs.existsSync(file)) return file } catch (e3) {}
  }
  return ''
}

async function getOfficeConverter() {
  if (OFFICE_CONVERTER) return OFFICE_CONVERTER
  if (OFFICE_LOADING) return OFFICE_LOADING
  OFFICE_LOADING = (async function () {
    const entry = findOfficeKitEntry()
    if (!entry) throw new Error('这个宿主没有找到 LibreOffice 预览引擎（libreoffice-kit）')
    const mod = await import(pathToFileURL(entry).href)
    if (!mod || typeof mod.createConverter !== 'function') throw new Error('LibreOffice 预览引擎缺少 createConverter')
    OFFICE_CONVERTER = await mod.createConverter({ timeoutMs: 120000 })
    return OFFICE_CONVERTER
  })()
  try { return await OFFICE_LOADING } finally { OFFICE_LOADING = null }
}

function trimOfficeCache() {
  while (OFFICE_CACHE.size > OFFICE_CACHE_MAX) {
    const first = OFFICE_CACHE.keys().next()
    if (first.done) break
    OFFICE_CACHE.delete(first.value)
  }
}

const ROUTES = {
  // 已装插件清单：给「插件接口」窗口当目录用。
  // 插件自己的 HTTP 前缀没法从 webServer 里枚举到（路由表不在可读字段上），
  // 所以这里先列出「装了谁」，路径让用户在窗口里填/试。
  plugins: async function () {
    try {
      const dirs = [
        path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'desktop', 'node_modules'),
        path.join(process.cwd(), 'node_modules'),
      ]
      const seen = new Set()
      const out = []
      const readOne = function (name, dir) {
        if (seen.has(name)) return
        seen.add(name)
        const rec = { name: name, version: '', desc: '', routes: [] }
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, name, 'package.json'), 'utf8'))
          rec.version = String(pkg.version || '')
          rec.desc = String(pkg.description || '').slice(0, 90)
          if (Array.isArray(pkg.dsh && pkg.dsh.bundles)) rec.desc = rec.desc || 'bundle'
        } catch (e) {}
        // 顺手把这个插件的 HTTP 端点找出来：它的代码里写着 `/_dsh/<它自己>/<方法>`，
        // 探针窗格就能直接点一下调出来，而不是让用户去猜路径。
        try {
          const hits = new Set()
          const files = ['lib/index.js', 'lib/client.js', 'index.js', 'client.js']
          for (const f of files) {
            const fp = path.join(dir, name, f)
            let st2 = null
            try { st2 = fs.statSync(fp) } catch (e2) { continue }
            if (!st2.isFile() || st2.size > 8000000) continue
            let text = ''
            try { text = fs.readFileSync(fp, 'utf8') } catch (e3) { continue }
            const re = /["'`](\/_[a-z0-9-]+\/[A-Za-z0-9._\-\/]+)["'`]/g
            let m = re.exec(text)
            while (m) {
              const p = m[1]
              if (p.length < 6 || p.length > 90) { m = re.exec(text); continue }
              if (!/[A-Za-z]/.test(p)) { m = re.exec(text); continue }
              hits.add(p)
              m = re.exec(text)
            }
            if (hits.size > 24) break
          }
          rec.routes = Array.from(hits).slice(0, 24)
        } catch (e4) {}
        out.push(rec)
      }
      for (const base of dirs) {
        let names = []
        try { names = fs.readdirSync(base) } catch (e) { continue }
        for (const n of names) {
          if (n.indexOf('dsh-') !== 0) continue
          let st = null
          try { st = fs.statSync(path.join(base, n)) } catch (e) { continue }
          if (!st.isDirectory()) continue
          readOne(n, base)
        }
        let scope = []
        try { scope = fs.readdirSync(path.join(base, '@deepseek-ai')) } catch (e) { scope = [] }
        for (const n of scope) {
          if (n.indexOf('dsh-') !== 0) continue
          readOne('@deepseek-ai/' + n, base)
        }
      }
      out.sort(function (a, b) { return a.name < b.name ? -1 : 1 })
      return { ok: true, plugins: out.slice(0, 60) }
    } catch (err) {
      return { ok: false, err: String(err && err.message) }
    }
  },

  // 列出宿主里所有插件注册过的 HTTP 接口前缀：
  // 这些前缀就是「插件自己暴露的界面/数据」，画布可以按需开窗指向它们，
  // 而不必把整份客户端嵌进来。
  webRoutes: async function () {
    try {
      const ws = WEB_CTX && WEB_CTX.webServer
      if (!ws) return { ok: false, err: 'no webServer' }
      const out = { ok: true, own: [], data: [], found: [] }
      const push = function (p) {
        const s = String(p || '')
        if (!s || out.found.indexOf(s) >= 0) return
        out.found.push(s)
      }
      // Cordis 的属性多半是 getter，直接读会抛「cannot get property ... without inject」，
      // 所以只读 data 属性，其余只记录名字。
      const props = Object.getOwnPropertyNames(ws)
      for (const k of props.slice(0, 60)) {
        const d = Object.getOwnPropertyDescriptor(ws, k)
        if (!d) continue
        if (typeof d.get === 'function' || typeof d.set === 'function') {
          out.own.push(k + ':getter')
          continue
        }
        let v = d.value
        if (typeof v === 'string' && v.indexOf('/_dsh/') === 0) { out.own.push(k + ':path'); push(v); continue }
        if (!v || typeof v !== 'object') { out.own.push(k + ':' + typeof v); continue }
        out.data.push(k)
        let keys = []
        try { keys = Object.keys(v).slice(0, 30) } catch (e) { keys = [] }
        for (const kk of keys) {
          const dd = Object.getOwnPropertyDescriptor(v, kk)
          if (!dd || typeof dd.get === 'function') continue
          const item = dd.value
          if (typeof item === 'string' && item.indexOf('/_dsh/') === 0) push(item)
          else if (item && typeof item === 'object' && typeof item.path === 'string' && item.path.indexOf('/_dsh/') === 0) push(item.path)
          else if (item && typeof item.forEach === 'function' && typeof item.get === 'function') {
            // webServer 把「前缀 → 处理器」放在 Map 里，Map 的键就是插件的接口前缀。
            try {
              item.forEach(function (_handler, key) { push(key) })
            } catch (eMap) {}
          }
        }
      }
      return out
    } catch (err) {
      return { ok: false, err: String(err && err.message) }
    }
  },

  // 仪表预设的插件路由在不在：卡片先问一句，别让用户点出一个 404 还以为窗口坏了。
  // 只做 GET（这些看板路由都是 GET；要 POST 的那条由卡片自己带 method）。
  probeRoutes: async function (args) {
    try {
      const ws = WEB_CTX && WEB_CTX.webServer
      if (!ws) return { ok: false, err: 'no webServer', routes: {} }
      const base = `${ws.protocol}//127.0.0.1:${String(ws.port)}`
      const list = Array.isArray(args && args.routes) ? args.routes.slice(0, 24) : []
      const out = {}
      const probeOne = function (p) {
        return new Promise(function (resolve) {
          let done = false
          const finish = function (status) {
            if (done) return
            done = true
            out[p] = status
            resolve()
          }
          try {
            const req = http.request(base + p, { method: 'GET', timeout: 4000 }, function (res) {
              res.resume()
              finish(Number(res.statusCode) || 0)
            })
            req.on('timeout', function () { try { req.destroy() } catch (e) {} finish(0) })
            req.on('error', function () { finish(0) })
            req.end()
          } catch (e) {
            finish(0)
          }
        })
      }
      for (const p of list) await probeOne(String(p))
      return { ok: true, routes: out, at: Date.now() }
    } catch (err) {
      return { ok: false, err: String(err && err.message ? err.message : err), routes: {} }
    }
  },

  // 右栏诊断：把前端复制来的快照与最近的右栏日志拼在一起，用户点一下就能贴回来。
  diagnostics: function () {
    try {
      const file = path.join(os.tmpdir(), 'dsh-free-pane-trace.log')
      let lines = []
      try {
        const text = fs.readFileSync(file, 'utf8')
        lines = text.split('\n').filter(function (l) {
          return /right-hide|strip-audit|collapse-right|fp-reset|panel-missing/.test(l)
        }).slice(-40)
      } catch (eRead) {}
      return { ok: true, file, lines }
    } catch (err) {
      return { ok: false, err: String(err && err.message ? err.message : err), lines: [] }
    }
  },

  // 探测：宿主里有没有能列出会话（含归档标记）的服务，免得只靠磁盘目录猜。
  probeSessions: async function (args, ctxRef) {
    try {
      const svc = ctxRef && ctxRef.get ? ctxRef.get('sessions') : null
      if (!svc) return { ok: false, err: 'no sessions service' }
      const names = []
      let cur = svc
      for (let d = 0; cur && d < 3; d++) {
        for (const k of Object.getOwnPropertyNames(cur)) {
          if (k === 'constructor' || names.indexOf(k) >= 0) continue
          names.push(k)
        }
        cur = Object.getPrototypeOf(cur)
      }
      let keysOf = function (v) {
        try { return v && typeof v === 'object' ? Object.keys(v).slice(0, 40) : null } catch (e) { return null }
      }
      const out = { ok: true, names: names }
      let listShape = null
      if (typeof svc.list === 'function') {
        try {
          const arr = await svc.list()
          listShape = arr.map(function (e) {
            const keys = e && typeof e === 'object' ? Object.keys(e) : []
            const pick = {}
            for (const k of keys) {
              if (k === 'log' || k === 'events') continue
              const v = e[k]
              const t = typeof v
              if (v === null || t === 'string' || t === 'number' || t === 'boolean') pick[k] = v
              else if (Array.isArray(v)) pick[k] = 'array(' + v.length + ')'
              else if (t === 'object') pick[k] = 'object{' + Object.keys(v).slice(0, 8).join(',') + '}'
            }
            return pick
          })
        } catch (e) {
          out.listErr = String((e && e.message) || e)
        }
      }
      out.listShape = listShape
      for (const m of ['snapshot', 'catalog', 'projects', 'workspaces', 'query']) {
        if (typeof svc[m] !== 'function') continue
        try {
          const v = await svc[m]()
          out[m] = Array.isArray(v) ? { isArray: true, n: v.length, keys: keysOf(v[0]) } : { isArray: false, keys: keysOf(v), type: typeof v }
        } catch (e) {
          out[m] = { err: String((e && e.message) || e) }
        }
      }
      return out
    } catch (err) {
      return { ok: false, err: String(err && err.message ? err.message : err) }
    }
  },
  // 数据桥：把宿主里其他插件（这里是底部信息栏）已经算好的用量账本读出来，
  // 让窗格能显示真实数字，并让界面标清「这个数来自谁」。
  usageSnapshot: async function (args) {
    try {
      const dir = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-bottom-info-bar')
      const file = path.join(dir, 'usage-ledger.sqlite')
      if (!fs.existsSync(file)) return { ok: false, err: 'no ledger at ' + file }
      const sqlite = await import('node:sqlite')
      const db = new sqlite.DatabaseSync(file, { readOnly: true })
      try {
        const days = db.prepare('select day,currency,input,cacheRead,cacheWrite,output,cost,records from days order by day desc').all()
        const total = db.prepare('select coalesce(sum(cost),0) as cost from days').get()
        const want = String((args && args.sessionId) || '').trim()
        let session = null
        if (want) {
          const row = db.prepare('select sessionId,input,cacheRead,cacheWrite,output,minTs,maxTs from sessions where sessionId = ?').get(want)
          if (row) session = row
        }
        const recent = db.prepare('select ts,cost from records order by ts desc limit 1').get()
        const day = days[0] || null
        return {
          ok: true,
          source: 'dsh-bottom-info-bar',
          ledger: file,
          day: day,
          days: days.slice(0, 7),
          totalCost: total && total.cost,
          session: session,
          lastTs: recent && recent.ts,
          fetchedAt: Date.now(),
        }
      } finally {
        try { db.close() } catch (e0) {}
      }
    } catch (err) {
      return { ok: false, err: String(err && err.message ? err.message : err) }
    }
  },
  // 调试用：把前端的事件序列记到临时文件，方便定位拖放这类"看不见"的问题
  contextStats: function (args) {
    const row = contextStats(args && args.id)
    return row ? { ok: true, stats: row } : { ok: false }
  },
  sessionTitle: function (args) {
    try {
      const row = sessionTitle(args && args.id)
      return row ? { ok: true, id: row.id, title: row.title, cwd: row.cwd } : { ok: false, err: 'not found' }
    } catch (err) {
      return { ok: false, err: String(err && err.message ? err.message : err) }
    }
  },
  // 本地 OCR：dsh-ocr-local 把识别挂在宿主 webServer 的
  // /plugins/dsh-ocr-local/api/ocr 上，并且只接受"同源"请求。
  // 画布在桌面版里是 dsh-app:// 源，直接 fetch 会被它 403，所以由宿主代发一次。
  ocr: async function (args) {
    try {
      const t = TARGET
      if (!t) return { ok: false, error: 'proxy target not ready' }
      const payload = JSON.stringify({
        path: String((args && args.path) || ''),
        mode: String((args && args.mode) || 'dual'),
      })
      const r = await fetch(`${t.protocol}//${t.host}/plugins/dsh-ocr-local/api/ocr`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
          'accept': 'application/json',
          'accept-language': 'zh-CN,zh;q=0.9',
          'host': t.host,
          'origin': `${t.protocol}//${t.host}`,
          'referer': `${t.protocol}//${t.host}/`,
        },
        body: payload,
      })
      const text = await r.text()
      let body = null
      try { body = JSON.parse(text) } catch (eParse) { body = null }
      if (body) return Object.assign({ status: r.status }, body)
      return { ok: false, status: r.status, error: String(text || '').slice(0, 300) }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  },
  log: function (args) {
    try {
      const file = path.join(os.tmpdir(), 'dsh-free-pane-trace.log')
      const line = new Date().toISOString() + ' ' + JSON.stringify(args || {}) + '\n'
      fs.appendFileSync(file, line)
      return { ok: true, file: file }
    } catch (err) {
      return { ok: false, err: String(err && err.message ? err.message : err) }
    }
  },
  traceReset: function () {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'dsh-free-pane-trace.log'), '')
      return { ok: true }
    } catch (err) {
      return { ok: false }
    }
  },
  // 默认目录：文件卡 / Git 卡没有显式路径时用它，不写死盘符。
  envInfo: function () {
    return { ok: true, cwd: process.cwd(), home: os.homedir(), platform: process.platform }
  },
  // Office → PDF：只读预览，不修改源文件；结果缓存在内存里，文件一变 key 就变。
  officePreview: async function (args) {
    try {
      const p = path.resolve(String((args && args.path) || ''))
      if (!p) return { ok: false, err: '空路径' }
      const ext = path.extname(p).toLowerCase()
      if (!OFFICE_EXT.has(ext)) return { ok: false, err: '不支持的 Office 格式：' + ext }
      const st = fs.statSync(p)
      if (!st.isFile()) return { ok: false, err: '不是常规文件' }
      if (st.size > 60 * 1024 * 1024) return { ok: false, err: '文件超过 60 MB，预览转换已跳过' }
      const key = p + '|' + st.mtimeMs + '|' + st.size
      const hit = OFFICE_CACHE.get(key)
      if (hit) { OFFICE_CACHE.delete(key); OFFICE_CACHE.set(key, hit); return Object.assign({}, hit, { cached: true }) }
      const converter = await getOfficeConverter()
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-free-pane-office-'))
      const out = path.join(dir, 'preview.pdf')
      try {
        const res = await converter.convert({ inputPath: p, outputPath: out })
        const buf = fs.readFileSync(out)
        if (buf.length > 24 * 1024 * 1024) return { ok: false, err: '转换出的 PDF 超过 24 MB' }
        // 第一页 PNG：文件卡默认显示这张轻量缩略图，点它再展开完整 PDF。
        // 这样既“点开就看到内容”，又不会一上来铺一块灰底的 PDF 工具条。
        let thumb = ''
        try {
          const imgDir = path.join(dir, 'pages')
          const manifest = await converter.renderImages({
            inputPath: out,
            outputDir: imgDir,
            pages: [1],
            dpi: 110,
            maxPages: 1,
            maxPixels: 4000000,
            maxDimension: 4096,
          })
          const first = manifest && Array.isArray(manifest.images) ? manifest.images[0] : null
          if (first && first.path && fs.existsSync(first.path)) {
            const png = fs.readFileSync(first.path)
            if (png.length <= 4 * 1024 * 1024) {
              thumb = 'data:image/png;base64,' + png.toString('base64')
            }
          }
        } catch (eThumb) {}
        const rec = {
          ok: true,
          kind: 'pdf',
          dataUrl: 'data:application/pdf;base64,' + buf.toString('base64'),
          thumb: thumb,
          name: path.basename(p),
          size: st.size,
          pageCount: Number(res && res.pageCount) || 0,
          backend: String((res && res.backend) || ''),
          at: Date.now(),
        }
        OFFICE_CACHE.set(key, rec)
        trimOfficeCache()
        return rec
      } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch (eRm) {}
      }
    } catch (err) {
      return { ok: false, err: String((err && err.message) || err), code: String((err && err.code) || '') }
    }
  },
  listSessions: function () {
    return { sessions: listSessions(), at: Date.now() }
  },
  exec: function (args) {
    return new Promise(function (resolve) {
      const cmd = String(args && args.cmd ? args.cmd : '')
      if (!cmd) {
        resolve({ ok: false, out: '', err: 'empty command', code: -1 })
        return
      }
      const opts = {
        cwd: String((args && args.cwd) || process.cwd()),
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      }
      function done(err, stdout, stderr) {
        resolve({
          ok: !err,
          out: String(stdout || ''),
          err: String(stderr || '') + (err && err.killed ? '\n[timeout]' : ''),
          code: err && typeof err.code === 'number' ? err.code : 0,
        })
      }
      // 命令按 PowerShell 解释：Windows 上 exec 的默认 shell 是 cmd.exe，
      // 直接跑会让 Get-ChildItem / Write-Output 这类 cmdlet 报「不是内部或外部命令」。
      if (process.platform === 'win32') {
        execFileChild('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + cmd,
        ], opts, done)
      } else {
        execFileChild('/bin/sh', ['-lc', cmd], opts, done)
      }
    })
  },
  listDir: function (args) {
    const dir = String((args && args.dir) || process.cwd())
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true }).map(function (d) {
        const one = { name: d.name, dir: d.isDirectory() }
        if (!one.dir) {
          try {
            one.size = fs.statSync(path.join(dir, d.name)).size
          } catch (eSize) {}
        }
        return one
      })
      // 文件夹排在前面，方便「先看到的都是能进去的」。
      entries.sort(function (a, b) {
        if (a.dir !== b.dir) return a.dir ? -1 : 1
        return String(a.name).localeCompare(String(b.name), 'zh-CN')
      })
      return { ok: true, dir, entries }
    } catch (e) {
      return { ok: false, dir, entries: [], err: String(e && e.message) }
    }
  },
  statPath: function (args) {
    const p = String((args && args.path) || '')
    if (!p) return { ok: false, err: 'empty path' }
    try {
      const st = fs.statSync(p)
      const isDir = st.isDirectory()
      return {
        ok: true,
        path: p,
        isDir,
        dir: isDir ? p : path.dirname(p),
        name: path.basename(p),
        size: st.size,
      }
    } catch (e) {
      return { ok: false, path: p, isDir: false, dir: p, name: path.basename(p), err: String((e && e.message) || e) }
    }
  },
  // 读一个文件的内容给「文件卡片」预览：文本按 UTF-8 解码（可截断），图片回 data URL，
  // 二进制就明说读不了，别把乱码塞回页面。
  readFile: function (args) {
    const p = String((args && args.path) || '')
    if (!p) return { ok: false, err: '空路径' }
    const wantCap = Number((args && args.maxBytes) || 0)
    const cap = wantCap > 0 ? wantCap : 512 * 1024
    const textExt = ['.txt', '.md', '.markdown', '.mdx', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.jsonl', '.ndjson', '.css', '.scss', '.less', '.html', '.htm', '.xml', '.svg', '.yml', '.yaml', '.toml', '.ini', '.conf', '.cfg', '.properties', '.csv', '.tsv', '.log', '.ps1', '.psm1', '.bat', '.cmd', '.sh', '.bash', '.zsh', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.php', '.lua', '.sql', '.gradle', '.lock', '.patch', '.diff', '.env', '.gitignore', '.gitattributes', '.npmrc', '.editorconfig', '.dsh']
    const imgExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif']
    const pdfExt = ['.pdf']
    const audioExt = ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus']
    const videoExt = ['.mp4', '.webm', '.ogv', '.mov', '.m4v']
    const mimeByExt = {
      '.pdf': 'application/pdf',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
      '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/opus',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
      '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.zip': 'application/zip', '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
      '.exe': 'application/octet-stream', '.dll': 'application/octet-stream',
    }
    function mimeOf(ext) {
      if (mimeByExt[ext]) return mimeByExt[ext]
      if (imgExt.indexOf(ext) >= 0) {
        if (ext === '.ico') return 'image/x-icon'
        if (ext === '.svg') return 'image/svg+xml'
        return 'image/' + ext.slice(1)
      }
      return 'application/octet-stream'
    }
    function asDataUrl(mime, buf) {
      return 'data:' + mime + ';base64,' + buf.toString('base64')
    }
    function looksText(buf) {
      const n = Math.min(buf.length, 4096)
      let bad = 0
      for (let i = 0; i < n; i += 1) {
        const b = buf[i]
        if (b === 0) return false
        if (b < 7 || (b > 13 && b < 32 && b !== 27)) bad += 1
      }
      return n === 0 ? true : bad / n < 0.02
    }
    try {
      const st = fs.statSync(p)
      if (st.isDirectory()) return { ok: false, path: p, name: path.basename(p), err: '这是一个文件夹，点它进目录就行' }
      const ext = path.extname(p).toLowerCase()
      const name = path.basename(p)
      const base = { path: p, name, size: st.size, ext, mtime: st.mtimeMs, mime: mimeOf(ext) }
      if (pdfExt.indexOf(ext) >= 0) {
        if (st.size > 24 * 1024 * 1024) return Object.assign({ ok: false, kind: 'pdf' }, base, { err: 'PDF 超过 24MB，页面里放不下；点「系统打开」看' })
        return Object.assign({ ok: true, kind: 'pdf', dataUrl: asDataUrl('application/pdf', fs.readFileSync(p)) }, base)
      }
      if (audioExt.indexOf(ext) >= 0) {
        if (st.size > 24 * 1024 * 1024) return Object.assign({ ok: false, kind: 'audio' }, base, { err: '音频超过 24MB，页面里放不下；点「系统打开」听' })
        return Object.assign({ ok: true, kind: 'audio', dataUrl: asDataUrl(base.mime, fs.readFileSync(p)) }, base)
      }
      if (videoExt.indexOf(ext) >= 0) {
        if (st.size > 24 * 1024 * 1024) return Object.assign({ ok: false, kind: 'video' }, base, { err: '视频超过 24MB，页面里放不下；点「系统打开」看' })
        return Object.assign({ ok: true, kind: 'video', dataUrl: asDataUrl(base.mime, fs.readFileSync(p)) }, base)
      }
      if (imgExt.indexOf(ext) >= 0) {
        if (st.size > 12 * 1024 * 1024) return Object.assign({ ok: false, kind: 'image' }, base, { err: '图片超过 12MB，就不往页面里塞了' })
        return Object.assign({ ok: true, kind: 'image', dataUrl: asDataUrl(base.mime, fs.readFileSync(p)) }, base)
      }
      const buf = fs.readFileSync(p)
      if (textExt.indexOf(ext) < 0 && !looksText(buf)) {
        const small = buf.length <= 8 * 1024 * 1024
        return Object.assign({
          ok: true,
          kind: 'binary',
          downloadUrl: small ? asDataUrl(base.mime, buf) : '',
          note: small ? '这种格式浏览器不能内嵌渲染；可以下载副本或用「系统打开」。' : '文件较大，只在系统里打开。',
        }, base)
      }
      const slice = buf.length > cap ? buf.slice(0, cap) : buf
      // UTF-16 的文本（Windows 记事本另存为常是这种）也当文本读，别因为 BOM/NUL 判成二进制。
      let text = ''
      if (slice.length >= 2 && slice[0] === 0xff && slice[1] === 0xfe) {
        text = slice.slice(2).toString('utf16le')
      } else if (slice.length >= 2 && slice[0] === 0xfe && slice[1] === 0xff) {
        const sw = Buffer.from(slice.slice(2))
        if (sw.length % 2 === 0) sw.swap16()
        text = sw.toString('utf16le')
      } else {
        text = slice.toString('utf8')
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      }
      return Object.assign({ ok: true, kind: 'text', text, truncated: buf.length > cap, maxBytes: cap }, base)
    } catch (e) {
      return { ok: false, path: p, err: String((e && e.message) || e) }
    }
  },
  // 用系统默认程序打开一个文件：文件卡片里「在系统里打开」用它。
  openPath: function (args) {
    const p = String((args && args.path) || '')
    if (!p) return { ok: false, err: '空路径' }
    try {
      if (process.platform === 'win32') {
        spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref()
      } else if (process.platform === 'darwin') {
        spawn('open', [p], { detached: true, stdio: 'ignore' }).unref()
      } else {
        spawn('xdg-open', [p], { detached: true, stdio: 'ignore' }).unref()
      }
      return { ok: true, path: p }
    } catch (e) {
      return { ok: false, path: p, err: String((e && e.message) || e) }
    }
  },
  // 从当前目录向下找 .git：Git 卡默认拿到的是工作区根目录，仓库往往在子目录里。
  // 限深度 2、最多 150 个目录，跳过依赖和临时目录，避免在大目录里卡住。
  findRepo: function (args) {
    try {
      const start = String((args && args.cwd) || process.cwd())
      const repos = []
      let visited = 0
      const skip = /^(node_modules|\.git|\.tmp|dist|build|out|coverage|\.cache|\.next|target|vendor)$/i
      function walk(dir, depth) {
        if (repos.length >= 10 || visited >= 600) return
        visited += 1
        try {
          if (fs.existsSync(path.join(dir, '.git'))) { repos.push(dir); return }
        } catch (e0) {}
        if (depth >= 2) return
        let entries = []
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e1) { return }
        for (const ent of entries) {
          if (!ent.isDirectory() || skip.test(ent.name)) continue
          walk(path.join(dir, ent.name), depth + 1)
          if (repos.length >= 10 || visited >= 600) return
        }
      }
      walk(start, 0)
      return { ok: true, start, repos, visited }
    } catch (err) {
      return { ok: false, err: String((err && err.message) || err), repos: [] }
    }
  },

  // Git 卡片的动作：状态之外至少要能暂存 / 提交，不能只显示一行 fatal。
  gitRun: function (args) {
    return new Promise(function (resolve) {
      const cwd = String((args && args.cwd) || process.cwd())
      const op = String((args && args.op) || '')
      const msg = String((args && args.message) || '')
      let argv = null
      if (op === 'add') argv = ['add', '-A']
      else if (op === 'commit') {
        if (!msg.trim()) { resolve({ ok: false, out: '', err: '先写提交说明' }); return }
        argv = ['commit', '-m', msg]
      } else if (op === 'init') argv = ['init']
      else if (op === 'log') argv = ['log', '--oneline', '-n', '8']
      else { resolve({ ok: false, out: '', err: 'unknown git op: ' + op }); return }
      execFileChild('git', argv, { cwd, timeout: 30000, windowsHide: true }, function (err, stdout, stderr) {
        resolve({
          ok: !err,
          out: String(stdout || ''),
          err: String(stderr || '') + (err && err.killed ? '\n[timeout]' : ''),
          code: err && typeof err.code === 'number' ? err.code : 0,
        })
      })
    })
  },
  gitStatus: function (args) {
    return new Promise(function (resolve) {
      const cwd = String((args && args.cwd) || process.cwd())
      execChild('git status --porcelain=v1 -b', { cwd, timeout: 20000, windowsHide: true }, function (err, stdout, stderr) {
        resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') })
      })
    })
  },
  proxyUrl: function () {
    startProxies()
    const urls = []
    for (let i = 0; i < PROXY_PORTS.length; i += 1) {
      const p = PROXY_PORTS[i]
      if (p) urls.push('http://127.0.0.1:' + String(p) + '/')
    }
    devWrite('proxy.json', {
      port: PROXY_PORT,
      ports: PROXY_PORTS.slice(),
      cookie: PROXY_COOKIE ? 'yes' : 'no',
      target: proxyTarget(),
    })
    return { port: PROXY_PORT, ports: PROXY_PORTS.slice(), urls, url: urls[0] || '' }
  },
  openInBrowser: function (args) {
    try {
      const url = String((args && args.url) || '')
      if (/^https?:\/\//i.test(url)) {
        if (process.platform === 'win32') {
          spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
        } else if (process.platform === 'darwin') {
          spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
        } else {
          spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
        }
      }
    } catch (openErr) {}
    return { ok: true }
  },
  authUrl: function () {
    try {
      if (WEB_CTX) {
        const base = `${WEB_CTX.webServer.protocol}//127.0.0.1:${String(WEB_CTX.webServer.port)}`
        const fresh = String(WEB_CTX.connection.authenticatedUrl(base))
        if (fresh) return fresh
      }
    } catch (freshErr) {}
    return AUTH_URL
  },
  dom: function (args) {
    devWrite('dom.json', args)
    return { ok: true }
  },
  lab: function (args) {
    const arm = devFile('probe-arm')
    const phase = String((args && args.phase) || 'get')
    if (phase === 'get') {
      return { armed: DEV && fs.existsSync(arm), target: proxyTarget() }
    }
    devWrite('probe.json', args && args.data ? args.data : args)
    try {
      if (phase === 'put' && DEV && fs.existsSync(arm)) fs.unlinkSync(arm)
    } catch (writeErr) {}
    return { ok: true }
  },
}

export function apply(ctx) {
  // 路由里偶尔要看宿主服务（比如会话列表/归档标记），把 ctx 挂到一个模块变量上。
  HOST_CTX = ctx
  // 安全闸（宿主侧）：%TEMP%\dsh-free-pane-off 存在时，不注册任何路由、不起代理。
  try {
    if (fs.existsSync(path.join(os.tmpdir(), 'dsh-free-pane-off'))) {
      console.warn('[free-pane] disabled by flag file dsh-free-pane-off')
      return
    }
  } catch (offErr) {}
  ctx.inject(['connection', 'webServer'], function (webCtx) {
    WEB_CTX = webCtx
    try {
      const base = `${webCtx.webServer.protocol}//127.0.0.1:${String(webCtx.webServer.port)}`
      const authed = String(webCtx.connection.authenticatedUrl(base))
      AUTH_URL = authed
      const webPort = Number(webCtx.webServer.port)
      TARGET = {
        port: webPort,
        host: `127.0.0.1:${String(webPort)}`,
        protocol: webCtx.webServer.protocol || 'http:',
      }
      try {
        const u = new URL(authed)
        AUTH_PATH = u.pathname + u.search
      } catch (pathErr) {}
      startProxies()
      setTimeout(function () {
        devWrite('proxy.json', { port: PROXY_PORT, ports: PROXY_PORTS.slice(), cookie: PROXY_COOKIE ? 'yes' : 'no' })
      }, 1200)
      setTimeout(refreshProxyCookie, 400)
      setTimeout(refreshProxyCookie, 3000)
      devWrite('authurl.json', { base, authed })
    } catch (urlErr) {
      devWrite('authurl.json', 'ERR ' + String(urlErr && urlErr.message))
    }
    webCtx.effect(function () {
      const srvs = PROXY_SERVERS.slice()
      return function () {
        try {
          for (const s of srvs) { try { s.close() } catch (oneErr) {} }
        } catch (closeErr) {}
        PROXY_SERVERS = []
        PROXY_PORTS = []
        PROXY_PORT = 0
        PROXY_COOKIE = ''
        TARGET = null
      }
    }, 'free-pane: GUI proxy')

    webCtx.effect(function () {
      const dispose = webCtx.webServer.register({
        kind: 'prefix',
        path: RPC_BASE,
        handler: async function (req, res) {
          let method = ''
          try {
            const rejection = webCtx.connection.requestRejection(req)
            if (rejection !== undefined) {
              respond(res, rejection, { error: 'rejected' })
              return
            }
            const url = new URL(req.url || '/', 'http://localhost')
            const at = url.pathname
            if (at.indexOf(RPC_BASE + '/') !== 0) {
              respond(res, 404, { error: 'not found' })
              return
            }
            method = decodeURIComponent(at.slice(RPC_BASE.length + 1))
            if (method === 'frame') {
              await serveFrame(url, res)
              return
            }
            if (!Object.prototype.hasOwnProperty.call(ROUTES, method)) {
              respond(res, 404, { error: 'unknown method: ' + method })
              return
            }
            // /exec 是在宿主进程里起一个真的子进程，别把它变成「任何能连到这个
            // webServer 的东西都能用的遥控器」：只收 POST，且必须带 x-fp-local: 1
            // （画布里的终端卡会带，见 client.js 的 TerminalCell）。
            // 明确一句：这是减速带，不是边界——同源页面 JS 照样能自己加这个头。
            // 真正的边界要靠 /frame 不出现在带会话的 origin 上（见 docs/audit-2026-11-16.md）。
            if (method === 'exec') {
              if (req.method !== 'POST') {
                respond(res, 405, { error: 'method not allowed' })
                return
              }
              if (String(req.headers['x-fp-local'] || '') !== '1') {
                respond(res, 403, { error: 'local-only' })
                return
              }
            }
            let args = {}
            if (req.method === 'POST') {
              const chunks = []
              let size = 0
              for await (const chunk of req) {
                size += chunk.length
                if (size > 64 * 1024) {
                  respond(res, 413, { error: 'body too large' })
                  return
                }
                chunks.push(chunk)
              }
              const raw = Buffer.concat(chunks).toString('utf8')
              if (raw.length > 0) {
                try {
                  args = JSON.parse(raw)
                } catch (err) {
                  respond(res, 400, { error: 'invalid JSON body' })
                  return
                }
              }
            }
            respond(res, 200, await ROUTES[method](args, HOST_CTX))
          } catch (err) {
            respond(res, 500, { error: String((err && err.message) || err) })
          }
        },
      })
      return function () {
        dispose()
      }
    }, 'dsh-free-pane: Web routes')
  })
}
// (rev bump for client bundle)
