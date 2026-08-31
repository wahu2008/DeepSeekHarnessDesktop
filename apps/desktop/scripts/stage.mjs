import { cp, rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Repo root (apps/desktop/scripts/ -> ../../../)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const flat = join(ROOT, 'apps', 'desktop', 'staging', 'dsh-flat')
const staging = join(ROOT, 'apps', 'desktop', 'staging', 'dsh')

await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })

// CLI package content -> staging/dsh (lib, config, package.json, ...)
await cp(join(flat, 'node_modules', '@deepseek-ai', 'dsh'), staging, { recursive: true, force: true })

// All packages -> staging/dsh/node_modules (deps resolve from dsh/lib/bin.js upward).
// NOTE: kept OUTSIDE the extraResources `from` root so electron-builder's hardcoded
// root-node_modules exclusion (filter.js: `relative === "node_modules"`) does not drop it.
await cp(join(flat, 'node_modules'), join(staging, 'node_modules'), { recursive: true, force: true })

console.log('STAGE DONE')
