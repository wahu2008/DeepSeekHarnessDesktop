import { createRequire } from 'node:module'
import { cp, readFile, rm, readdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve the repo root from this script's location (apps/desktop/scripts/ -> ../../../)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CLI_DIR = join(ROOT, 'apps', 'cli')
const PNPM_ROOT = join(ROOT, 'node_modules', '.pnpm')
const dst = join(ROOT, 'apps', 'desktop', 'staging', 'dsh-flat')

const makeRequire = (fromDir) => createRequire(join(fromDir, 'package.json'))
const depsOf = (pkg) => [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]

// name -> real-dir index over .pnpm/**/node_modules/** (catches import-only / unexported packages).
async function buildPnpmIndex() {
  const index = new Map()
  let entries
  try {
    entries = await readdir(PNPM_ROOT)
  } catch {
    return index
  }
  for (const entry of entries) {
    const nm = join(PNPM_ROOT, entry, 'node_modules')
    if (!existsSync(nm)) continue
    const tops = await readdir(nm).catch(() => [])
    for (const top of tops) {
      if (top.startsWith('@')) {
        const sub = await readdir(join(nm, top)).catch(() => [])
        for (const p of sub) index.set(`${top}/${p}`, join(nm, top, p))
      } else {
        index.set(top, join(nm, top))
      }
    }
  }
  return index
}
const pnpmIndex = await buildPnpmIndex()

function readPkg(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function findRoot(name, req) {
  let entry = null
  try {
    entry = req.resolve(name)
  } catch {
    try {
      entry = req.resolve(`${name}/package.json`)
    } catch {
      entry = null
    }
  }
  if (entry) {
    let dir = dirname(entry)
    for (let i = 0; i < 12; i++) {
      const p = readPkg(dir)
      if (p && p.name === name) return { dir, pkg: p }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  const indexed = pnpmIndex.get(name)
  if (indexed) {
    const p = readPkg(indexed)
    if (p) return { dir: indexed, pkg: p }
  }
  return null
}

const cliPkg = JSON.parse(await readFile(join(CLI_DIR, 'package.json'), 'utf8'))
const packages = [{ name: cliPkg.name, dir: CLI_DIR, pkg: cliPkg }]
const seen = new Set([cliPkg.name])
const unresolved = []
const queue = depsOf(cliPkg).map((name) => ({ name, req: makeRequire(CLI_DIR) }))

while (queue.length > 0) {
  const { name, req } = queue.shift()
  if (seen.has(name)) continue
  seen.add(name)
  const found = findRoot(name, req)
  if (!found) {
    unresolved.push(name)
    continue
  }
  packages.push({ name, ...found })
  const childReq = makeRequire(found.dir)
  for (const dep of depsOf(found.pkg)) {
    if (!seen.has(dep)) queue.push({ name: dep, req: childReq })
  }
}

await rm(dst, { recursive: true, force: true })
const EXCLUDE_DIR = new Set(['node_modules', 'tests', 'test', 'coverage', '.git'])
let copied = 0
for (const { name, dir } of packages) {
  const target = join(dst, 'node_modules', ...name.split('/'))
  const isExternal = dir.includes('.pnpm')
  const ok = await cp(dir, target, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = basename(src)
      if (EXCLUDE_DIR.has(base)) return false
      if (!isExternal && base === 'src') return false
      if (/\.(map|tsbuildinfo)$/.test(src)) return false
      return true
    },
  }).then(() => true).catch(() => false)
  if (ok) copied++
  else console.error('COPY FAILED for', name, 'dir=', dir)
}

console.log('FLATTEN DONE, packages =', packages.length, 'copied =', copied)
if (unresolved.length) console.error('UNRESOLVED (optional/other-platform, safe to ignore):', unresolved.join(', '))
