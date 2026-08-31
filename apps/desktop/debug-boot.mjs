import { boot, healProfilesModuleFallback, initProfile, loadLayeredEnv, loadProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const INSTALL_ANCHOR = require.resolve('@deepseek-ai/dsh/package.json')
console.log('INSTALL_ANCHOR =', INSTALL_ANCHOR)

healProfilesModuleFallback(INSTALL_ANCHOR)
const profileDir = resolveProfileDir('desktop')
console.log('profileDir =', profileDir)
initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-desktop-app'])
const profile = loadProfile('dsh', 'desktop', INSTALL_ANCHOR)
console.log('layers =', profile.layers.map(l => l.packageName))
writeFileSync(join(profile.dir, 'cordis.yml'), '# dsh profile root\n[]\n')

const patches = [...profile.layers.flatMap(l => l.patches), ...profile.patches]
console.log('patch entries =', patches.length)
const env = loadLayeredEnv('dsh', process.cwd())

try {
  const ctx = await boot('dsh', join(profile.dir, 'cordis.yml'), patches, (h) => {
    h.provide(DSH_LAUNCH_ENVIRONMENT_KEY, env)
    provideCmdline(h, { args: [], exit: () => {} })
  })
  console.log('BOOTED OK')
  await ctx.fiber.dispose()
  process.exit(0)
} catch (e) {
  console.error('BOOT FAILED:', e?.message ?? e)
  let c = e
  while (c && c.cause) c = c.cause
  if (c && Array.isArray(c.errors)) {
    for (const [i, err] of c.errors.entries()) {
      console.error(`  [${i}]`, err?.message ?? String(err))
    }
  }
  process.exit(1)
}
