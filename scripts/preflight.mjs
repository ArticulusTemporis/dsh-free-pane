import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const errors = []
const warnings = []
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const required = [
  'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg',
  'locale/zh.json', 'locale/en.json',
  'README.md', 'CHANGELOG.md', 'LICENSE',
  'docs/install.md', 'docs/card-kinds.md', 'docs/session-operations.md',
  'skills/free-pane-plugin-adapter/SKILL.md',
]
for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) errors.push('missing ' + rel)
}

if (pkg.private !== false) errors.push('package.json private must be false for distribution')
if (!pkg.dsh || !pkg.dsh.bundle || !pkg.dsh.bundle.patch) errors.push('missing dsh.bundle.patch')
if (!pkg.engines || !pkg.engines.dsh) errors.push('missing engines.dsh compatibility range')
if (!/^0\.2\.2-rc\.5\b/.test(String(pkg.engines && pkg.engines.dsh).replace(/^[^\d]*/, ''))) {
  warnings.push('engines.dsh does not start at the tested 0.2.2-rc.5 baseline: ' + String(pkg.engines && pkg.engines.dsh))
}
if (!Array.isArray(pkg.files) || !pkg.files.includes('docs/*.md')) warnings.push('files should include docs/*.md')

for (const js of ['index.js', 'client.js']) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, js)], { encoding: 'utf8' })
  if (r.status !== 0) errors.push(js + ' syntax: ' + (r.stderr || r.stdout).trim())
}

const forbidden = [
  /D:\\\\?fix/i,
  /C:\\\\?Users\\\\?arlec/i,
  /127\.0\.0\.1:\d{4,5}/,
  /\bfptest\b/,
  /session-[0-9a-f]{8}-[0-9a-f-]{20,}/i,
]
for (const js of ['index.js', 'client.js']) {
  const text = fs.readFileSync(path.join(root, js), 'utf8')
  for (const re of forbidden) {
    const m = re.exec(text)
    if (m) errors.push(js + ' contains machine-specific value: ' + m[0])
  }
}

const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
if (!patch.includes('dsh-free-pane')) errors.push('cordis.patch.yml does not insert dsh-free-pane')

const size = fs.statSync(path.join(root, 'client.js')).size
if (size < 100_000) warnings.push('client.js is unexpectedly small: ' + size)

if (errors.length) {
  console.error('[preflight] FAIL')
  for (const e of errors) console.error(' - ' + e)
  for (const w of warnings) console.error(' ! ' + w)
  process.exit(1)
}
console.log('[preflight] OK dsh-free-pane ' + pkg.version)
console.log('  engines.dsh: ' + (pkg.engines && pkg.engines.dsh))
console.log('  client.js: ' + Math.round(size / 1024) + ' KB')
for (const w of warnings) console.log('  ! ' + w)
