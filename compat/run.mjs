// Single-version compatibility harness for dsh-free-pane.
// It boots the current latest DSH web profile in an isolated DSH_HOME,
// installs the packed tarball, and drives Edge over CDP (no Playwright).
//
// Usage:
//   node compat/run.mjs
//   node compat/run.mjs --tarball dist/dsh-free-pane-0.10.18.tgz --keep
//   DSH_BIN=/path/to/dsh EDGE_BIN=/path/to/msedge node compat/run.mjs
//
// Exit 0 only when the plugin boots and the canvas + note card + diagnostics pass.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const keep = args.includes('--keep')
const tarballArg = valueOf('--tarball')
const dshBin = process.env.DSH_BIN || 'dsh'
const edgeBin = process.env.EDGE_BIN || findEdge()

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const pinned = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'versions.json'), 'utf8'))
const latestDsh = String(pinned.latest || '')
if (!latestDsh) fail('compat/versions.json is missing latest')
const tarball = path.resolve(root, tarballArg || path.join('dist', `dsh-free-pane-${pkg.version}.tgz`))
if (!fs.existsSync(tarball)) fail('tarball not found: ' + tarball + ' (run npm run pack first)')

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const work = path.join(root, '.tmp', 'compat-latest-' + stamp)
const home = path.join(work, 'dsh-home')
const edgeProfile = path.join(work, 'edge-profile')
const profile = 'compat'
fs.mkdirSync(home, { recursive: true })
fs.mkdirSync(edgeProfile, { recursive: true })

const report = { startedAt: new Date().toISOString(), dsh: null, plugin: pkg.version, checks: [], errors: [] }
let server = null
let edge = null
let browser = null

function valueOf(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : ''
}
function fail(message) {
  console.error('[compat] FAIL ' + message)
  process.exit(1)
}
function findEdge() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ]
  const hit = candidates.find((p) => fs.existsSync(p))
  if (!hit) fail('Edge/Chrome not found; set EDGE_BIN')
  return hit
}
function run(bin, argv, opts = {}) {
  const r = spawnSync(bin, argv, {
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    shell: true,
    env: { ...process.env, DSH_HOME: home, ...(opts.env || {}) },
    cwd: root,
  })
  if (r.status !== 0) {
    throw new Error(`${path.basename(bin)} ${argv.join(' ')} failed (${r.status})\n${r.stdout || ''}\n${r.stderr || ''}`)
  }
  return r
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(new Error('bad json: ' + body.slice(0, 200))) } })
    })
    req.on('error', reject)
    req.setTimeout(2000, () => { req.destroy(new Error('timeout')) })
  })
}
async function waitHttp(url, timeout = 20000) {
  const end = Date.now() + timeout
  let last = ''
  while (Date.now() < end) {
    try { return await getJson(url) } catch (e) { last = String(e && e.message) }
    await sleep(250)
  }
  throw new Error('HTTP not ready: ' + url + ' (' + last + ')')
}

// Minimal CDP client over the built-in WebSocket (Node 24).
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP socket error')), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (ev) => {
    let msg
    try { msg = JSON.parse(String(ev.data)) } catch { return }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'))
      else p.resolve(msg.result)
      return
    }
    events.push(msg)
  })
  function send(method, params = {}) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (!pending.has(id)) return
        pending.delete(id)
        reject(new Error('CDP timeout: ' + method))
      }, 15000)
    })
  }
  return { ws, send, events, close: () => ws.close() }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (r.exceptionDetails) {
    throw new Error('page exception: ' + (r.exceptionDetails.text || '') + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''))
  }
  return r.result ? r.result.value : undefined
}

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail).slice(0, 500) })
  console.log(`[compat] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`)
  return !!ok
}

try {
  const version = String(spawnSync(dshBin, ['--version'], { encoding: 'utf8', shell: true, env: { ...process.env, DSH_HOME: home } }).stdout || '').trim()
  report.dsh = version
  console.log('[compat] dsh ' + version + ' @ ' + dshBin)
  if (version !== latestDsh) throw new Error('expected current latest DSH ' + latestDsh + ', got ' + (version || '(none)') + '; update compat/versions.json only after verifying the new version')
  console.log('[compat] plugin ' + pkg.version + ' tarball ' + tarball)
  console.log('[compat] work ' + work)

  // 1. Fresh web profile, install the packed artifact, boot it.
  run(dshBin, ['--profile', profile, '--from-default-profile', 'web', '--dump-config'], { timeout: 120000 })
  run(dshBin, ['plugin', '--profile', profile, 'add', tarball], { timeout: 180000 })

  const serverOut = []
  server = spawn(dshBin, ['--profile', profile, '--no-open', '--port', '0'], {
    shell: true,
    cwd: root,
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (d) => serverOut.push(String(d)))
  server.stderr.on('data', (d) => serverOut.push(String(d)))
  const deadline = Date.now() + 60000
  let url = ''
  while (Date.now() < deadline && !url) {
    const text = serverOut.join('')
    const m = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/.exec(text)
    if (m) url = m[0]
    if (server.exitCode !== null) break
    await sleep(500)
  }
  if (!url) throw new Error('web server URL not printed\n' + serverOut.join('').slice(-4000))
  console.log('[compat] web ' + url.replace(/token=.*/, 'token=***'))

  // 2. Headless Edge, one page.
  edge = spawn(edgeBin, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--user-data-dir=' + edgeProfile, url,
  ], { stdio: 'ignore' })
  const portFile = path.join(edgeProfile, 'DevToolsActivePort')
  let devPort = 0
  for (let i = 0; i < 120 && !devPort; i += 1) {
    try { devPort = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]) } catch {}
    if (!devPort) await sleep(250)
  }
  if (!devPort) throw new Error('Edge DevToolsActivePort not ready')
  const pages = await waitHttp(`http://127.0.0.1:${devPort}/json/list`)
  const page = (Array.isArray(pages) ? pages : []).find((p) => p.type === 'page')
  if (!page || !page.webSocketDebuggerUrl) throw new Error('no page target: ' + JSON.stringify(pages).slice(0, 500))
  browser = await connect(page.webSocketDebuggerUrl)
  await browser.send('Page.enable')
  await browser.send('Runtime.enable')
  await browser.send('Log.enable')

  // 3. Boot + canvas + a note card + host RPC.
  let ready = false
  for (let i = 0; i < 40; i += 1) {
    ready = await evaluate(browser, `!!document.querySelector('button[aria-label="自由窗格"]')`)
    if (ready) break
    await sleep(500)
  }
  check('app boot + free-pane rail', ready)
  if (!ready) throw new Error('free-pane rail not found')

  await evaluate(browser, `document.querySelector('button[aria-label="自由窗格"]')?.click()`)
  await sleep(2500)
  // The preview notice can appear after the rail click; dismiss it in a short retry loop.
  let dismissed = []
  for (let i = 0; i < 12; i += 1) {
    const label = await evaluate(browser, `(() => {
      const b=[...document.querySelectorAll('button')].find(x=>/继续|知道了|稍后/.test((x.textContent||'').trim()))
      if(b){ const t=(b.textContent||'').trim(); b.click(); return t }
      const d=[...document.querySelectorAll('[role="dialog"]')][0]
      if(!d) return ''
      const bs=[...d.querySelectorAll('button')]
      const x=bs.find(b=>/关闭|close/i.test((b.getAttribute('aria-label')||'')+(b.getAttribute('title')||''))) ||
              bs.find(b=>!((b.textContent||'').trim()) && b.getBoundingClientRect().top < d.getBoundingClientRect().top + 64 &&
                b.getBoundingClientRect().left > d.getBoundingClientRect().right - 80)
      if(x){ x.click(); return 'x' }
      return ''
    })()`)
    if (label) { dismissed.push(label); await sleep(400) } else break
  }
  check('canvas mounts', await evaluate(browser, `!!document.querySelector('.fp-canvas')`))
  // The preview notice must be gone; the sign-in dialog is expected and is not a plugin failure.
  check('preview notice dismissed', await evaluate(browser, `![...document.querySelectorAll('[role="dialog"]')].some(d=>/预览版说明/.test(d.innerText||''))`), dismissed.join(','))
  check('add button present', await evaluate(browser, `!!document.querySelector('.fp-fab')`))

  const before = Number(await evaluate(browser, `document.querySelectorAll('.fp-win').length`))
  await evaluate(browser, `document.querySelector('.fp-fab')?.click()`)
  await sleep(500)
  const labels = await evaluate(browser, `[...document.querySelectorAll('.fp-menu-label')].map(x=>x.textContent.trim())`)
  const expected = ['会话', '文件', '浏览器', '笔记', '终端', 'Git', '设置']
  const coreLabels = labels.filter((x) => expected.includes(x))
  check('add menu is the 7 basic kinds', coreLabels.length === 7 && expected.every((x) => labels.includes(x)), labels.join(','))
  check('empty pane at the bottom', labels[labels.length - 1] === '填空窗格', labels.join(','))
  // Add the note while the add sheet is open, before changing zoom.
  const picked = await evaluate(browser, `(() => { const b=[...document.querySelectorAll('.fp-menu-label')].find(x=>x.textContent.trim()==='笔记'); if(!b) return false; b.parentElement.click(); return true })()`)
  await sleep(1500)
  const noteAdded = await evaluate(browser, `!!document.querySelector('.fp-mdnote-input')`)
  const cards = Number(await evaluate(browser, `document.querySelectorAll('.fp-win').length`))
  // The default canvas is one empty pane, so addContent fills it instead of adding a second card.
  check('add a note fills the empty pane', picked && noteAdded, `before=${before} after=${cards}`)

  const zooms = await evaluate(browser, `[...(document.querySelector('.fp-zoom-all')?.options||[])].map(o=>o.value)`)
  check('global zoom 75/100/125', zooms.join(',') === '75,100,125', zooms.join(','))
  const scale75 = Number(await evaluate(browser, `(() => { const el=document.querySelector('.fp-ui'); const m=new DOMMatrix(getComputedStyle(el).transform); return Math.round(m.a*100)/100 })()`))
  const bar75 = Number(await evaluate(browser, `Math.round(document.querySelector('.fp-appbar')?.getBoundingClientRect().height || 0)`))
  check('75% is the no-scale baseline', scale75 === 1 && bar75 === 36, `scale=${scale75} bar=${bar75}`)
  check('global zoom applies', await evaluate(browser, `document.querySelector('.fp-zoom-all')?.value === '75'`))
  check('ui wrapper present', await evaluate(browser, `!!document.querySelector('.fp-ui')`))
  await evaluate(browser, `(() => { const s=document.querySelector('.fp-zoom-all'); s.value='100'; s.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  await sleep(400)
  const scale100 = Number(await evaluate(browser, `(() => { const el=document.querySelector('.fp-ui'); const m=new DOMMatrix(getComputedStyle(el).transform); return Math.round(m.a*100)/100 })()`))
  const bar100 = Number(await evaluate(browser, `Math.round(document.querySelector('.fp-appbar')?.getBoundingClientRect().height || 0)`))
  check('100% = Material 3 default size', Math.abs(scale100 - 1.33) <= 0.01 && bar100 === 48, `scale=${scale100} bar=${bar100}`)
  await evaluate(browser, `(() => { const s=document.querySelector('.fp-zoom-all'); s.value='125'; s.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  await sleep(500)
  const scale125 = Number(await evaluate(browser, `(() => { const el=document.querySelector('.fp-ui'); const m=new DOMMatrix(getComputedStyle(el).transform); return Math.round(m.a*100)/100 })()`))
  const bar125 = Number(await evaluate(browser, `Math.round(document.querySelector('.fp-appbar')?.getBoundingClientRect().height || 0)`))
  check('125% scales topbar', Math.abs(scale125 - 1.67) <= 0.01 && bar125 === 60, `scale=${scale125} bar=${bar125}`)

  const diag = await evaluate(browser, `fetch('/_dsh/dsh-free-pane/diagnostics').then(r=>r.json())`)
  check('host RPC diagnostics', !!(diag && diag.ok), JSON.stringify(diag).slice(0, 200))

  const errors = browser.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params?.exceptionDetails?.text || e.method)
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  const shot = await browser.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(work, 'screen.png'), Buffer.from(shot.data, 'base64'))
  report.screenshot = path.join(work, 'screen.png')
  report.url = url.replace(/token=.*/, 'token=***')

  const failed = report.checks.filter((c) => !c.ok)
  report.ok = failed.length === 0
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log('[compat] report ' + path.join(work, 'report.json'))
  if (failed.length) throw new Error(failed.length + ' check(s) failed')
  console.log('[compat] PASS')
} catch (e) {
  report.ok = false
  report.error = String(e && e.stack || e)
  fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.error('[compat] FAIL ' + (e && e.message || e))
  process.exitCode = 1
} finally {
  try { if (browser) browser.close() } catch {}
  try { if (edge) edge.kill() } catch {}
  try { if (server) server.kill() } catch {}
  await sleep(500)
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(edge && edge.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    try { spawnSync('taskkill', ['/pid', String(server && server.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  }
  if (!keep && report.ok) {
    try { fs.rmSync(work, { recursive: true, force: true }) } catch {}
  } else {
    console.log('[compat] kept ' + work)
  }
}
