/**
 * Profile bundle-manifest watching (`watchProfileBundles`): a change to the
 * profile's `dsh.profile.bundles` list (a `dsh plugin add` / the market's
 * pnpm install) must re-resolve the NEW bundle's patch layer and hot-insert
 * it into the running Include tree — no host restart. Removal and reorder
 * replay through the same transactional HMR path.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { boot, loadOverlayPatches, watchProfileBundles } from '../src/index.ts'

const NAME = 'dsh-test-bin'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-profile-bundles-'))

async function eventually(test: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const settleChokidarChangeThrottle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 75))

function entryConfig(ctx: Context, id: string): unknown {
  return [...ctx.loader.entries()].find(entry => entry.options.id === id)?.options.config
}

/** One fake "bundle": a directory whose `cordis.patch.yml` inserts a noop row. */
function writeBundle(dir: string, name: string, value: string): void {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'cordis.patch.yml'), [
    '- insert:',
    `    - id: ${name}`,
    `      name: ./noop.mjs`,
    '      config:',
    `        value: ${value}`,
    '',
  ].join('\n'))
}

describe('watchProfileBundles', () => {
  it('watches add, config change, and removal of bundle layers through transactional HMR', { timeout: 30_000 }, async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'noop.mjs'), [
      'export const name = "noop"',
      'export function apply(_ctx, config = {}) {',
      '  if (config.fail) throw new Error("candidate config failed")',
      '}',
      '',
    ].join('\n'))
    // The "manifest": a JSON file listing the composed bundle order, standing
    // in for the profile's package.json `dsh.profile.bundles` array.
    const manifest = join(dir, 'package.json')
    writeBundle(dir, 'bundle-a', 'a1')
    writeBundle(dir, 'bundle-b', 'b1')
    writeFileSync(manifest, JSON.stringify({ bundles: ['bundle-a'] }))
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')

    // Mirror profile-boot's fresh-generation composition: bundle layers
    // resolved from the CURRENT manifest, then the user layers (empty here),
    // then overlays (empty).
    const compose = (): PatchOptions[] => {
      const { bundles } = JSON.parse(readFileSync(manifest, 'utf8')) as { bundles: string[] }
      return bundles.flatMap(name => loadOverlayPatches(NAME, join(dir, name, 'cordis.patch.yml')))
    }

    const ctx = await boot(NAME, join(dir, 'cordis.yml'), compose())
    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const failures: Array<{ filename: string; error: Error }> = []
    ctx.on('hmr/config-update-failed', (failedFilename, error) => {
      failures.push({ filename: failedFilename, error })
    })
    const dispose = await watchProfileBundles(ctx, { binName: NAME, filename: manifest, compose })
    try {
      expect(entryConfig(ctx, 'bundle-a')).toEqual({ value: 'a1' })

      // 1. Add: a `dsh plugin add` appends the bundle to the manifest; the new
      //    bundle's patch layer joins the live tree.
      writeFileSync(manifest, JSON.stringify({ bundles: ['bundle-a', 'bundle-b'] }))
      await eventually(() => entryConfig(ctx, 'bundle-b') !== undefined, 'added bundle layer was not hot-inserted')
      expect(entryConfig(ctx, 'bundle-b')).toEqual({ value: 'b1' })
      await settleChokidarChangeThrottle()

      // 2. Failure containment: a rejected candidate (a listed bundle whose
      //    patch file cannot resolve) keeps the last good tree.
      writeFileSync(manifest, JSON.stringify({ bundles: ['bundle-a', 'bundle-b', 'missing-bundle'] }))
      await eventually(() => failures.length >= 1, 'failed bundle resolution was not broadcast')
      expect(failures[0]?.filename).toBe(manifest)
      expect((entryConfig(ctx, 'bundle-b') as { value?: string })?.value).toBe('b1')
      await settleChokidarChangeThrottle()

      // 3. Recovery + removal: fixing the manifest drops the bad entry and the
      //    removal of a listed bundle retracts its layer.
      writeFileSync(manifest, JSON.stringify({ bundles: ['bundle-a', 'bundle-b'] }))
      await settleChokidarChangeThrottle()
      writeFileSync(manifest, JSON.stringify({ bundles: ['bundle-a'] }))
      await eventually(() => entryConfig(ctx, 'bundle-b') === undefined, 'removed bundle layer was not retracted')
      expect(entryConfig(ctx, 'bundle-a')).toEqual({ value: 'a1' })
    } finally {
      await dispose()
      await ctx.fiber.dispose()
    }
  })

  it('fails loud when the exact watcher lacks HMR or a root Include', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'noop.mjs'), 'export const name = "noop"\nexport function apply() {}\n')
    writeFileSync(join(dir, 'cordis.yml'), '- id: noop\n  name: ./noop.mjs\n')
    const manifest = join(dir, 'package.json')
    writeFileSync(manifest, JSON.stringify({ bundles: [] }))
    const compose = (): PatchOptions[] => []

    const withoutHmr = await boot(NAME, join(dir, 'cordis.yml'))
    try {
      await expect(watchProfileBundles(withoutHmr, { binName: NAME, filename: manifest, compose }))
        .rejects.toThrow('requires the Cordis HMR service')
    } finally {
      await withoutHmr.fiber.dispose()
    }

    const withoutInclude = new Context()
    withoutInclude.baseUrl = `file://${dir.replace(/\\/g, '/')}/`
    await withoutInclude.plugin(Loader)
    await withoutInclude.plugin(Timer)
    await withoutInclude.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    try {
      await expect(watchProfileBundles(withoutInclude, { binName: NAME, filename: manifest, compose }))
        .rejects.toThrow('requires the root Include entry')
    } finally {
      await withoutInclude.fiber.dispose()
    }
  })
})
