// @vitest-environment jsdom
/**
 * Browser-half graph reconciliation (`reconcileGraph`): a `graph` frame
 * pushed by the host (a `dsh plugin add` hot-activating a new bundle layer)
 * must prefetch and create entries the browser does not have yet, remove
 * entries the host dropped, stay idempotent against the boot baseline, and
 * contain per-row failures.
 */

import { describe, expect, it } from 'vitest'
import { reconcileGraph, type ReconcileDeps } from '../src/client/index.ts'

interface FakeEntry {
  id: string
  options: { name: string }
  fiber?: unknown
}

interface FakeLoader {
  entries(): FakeEntry[]
  removed: string[]
  created: string[]
  createdFiberless: Set<string>
  remove(id: string): Promise<void>
  create(options: { name: string }): Promise<string>
  resolve(id: string): FakeEntry | undefined
}

function makeLoader(initial: string[], opts: { fiberless?: string[] } = {}): FakeLoader {
  const entries: FakeEntry[] = initial.map(name => ({ id: `id-${name}`, options: { name } }))
  const fiberless = new Set(opts.fiberless ?? [])
  const loader: FakeLoader = {
    entries: () => entries,
    removed: [],
    created: [],
    createdFiberless: fiberless,
    async remove(id: string) {
      const index = entries.findIndex(entry => entry.id === id)
      if (index !== -1) entries.splice(index, 1)
      loader.removed.push(id)
    },
    async create(options: { name: string }) {
      const id = `id-${options.name}`
      const entry: FakeEntry = { id, options, ...(fiberless.has(options.name) ? {} : { fiber: {} }) }
      entries.push(entry)
      loader.created.push(options.name)
      return id
    },
    resolve(id: string) {
      return entries.find(entry => entry.id === id)
    },
  }
  return loader
}

function makeDeps(loader: FakeLoader, prefetchFailures: Set<string> = new Set()): {
  deps: ReconcileDeps
  prefetched: string[]
  warns: string[]
  errors: string[]
} {
  const prefetched: string[] = []
  const warns: string[] = []
  const errors: string[] = []
  const deps: ReconcileDeps = {
    loader: loader as unknown as ReconcileDeps['loader'],
    modLoader: {
      async prefetch(id: string) {
        if (prefetchFailures.has(id)) throw new Error(`prefetch failed for ${id}`)
        prefetched.push(id)
      },
    },
    warn(message: string, ...details: unknown[]) {
      warns.push(details.length > 0 ? `${message}: ${String(details[0])}` : message)
    },
    error(message: string, ...details: unknown[]) {
      errors.push(details.length > 0 ? `${message}: ${String(details[0])}` : message)
    },
  }
  return { deps, prefetched, warns, errors }
}

const graphOf = (ids: string[]) => ({ entries: ids.map(id => ({ id, url: `/plugins/${id}/client.js?rev=0`, rev: '0' })) })

describe('reconcileGraph', () => {
  it('creates rows added by the host and prefetches before create', async () => {
    const loader = makeLoader(['a'])
    const { deps, prefetched } = makeDeps(loader)
    const known = new Set<string>(['a'])

    await reconcileGraph(deps, graphOf(['a', 'b']), known)

    expect(prefetched).toEqual(['b'])
    expect(loader.created).toEqual(['b'])
    expect(loader.removed).toEqual([])
    expect(known).toEqual(new Set(['a', 'b']))
  })

  it('removes rows dropped by the host', async () => {
    const loader = makeLoader(['a', 'b'])
    const { deps } = makeDeps(loader)
    const known = new Set<string>(['a', 'b'])

    await reconcileGraph(deps, graphOf(['a']), known)

    expect(loader.removed).toEqual(['id-b'])
    expect(loader.created).toEqual([])
    expect(known).toEqual(new Set(['a']))
  })

  it('is idempotent against the boot baseline (no create for existing entries)', async () => {
    const loader = makeLoader(['a', 'b'])
    const { deps, prefetched } = makeDeps(loader)
    const known = new Set<string>(['a', 'b'])

    // Connect-time snapshot: entries already exist (boot created them).
    await reconcileGraph(deps, graphOf(['a', 'b']), known)

    expect(prefetched).toEqual([])
    expect(loader.created).toEqual([])
    expect(loader.removed).toEqual([])
    expect(known).toEqual(new Set(['a', 'b']))
  })

  it('adopts unknown-but-existing entries into the baseline without re-creating', async () => {
    // Known set starts empty (e.g. HMR mounted before boot finished), but the
    // entries already exist on the loader — track them, never duplicate.
    const loader = makeLoader(['a'])
    const { deps, prefetched } = makeDeps(loader)
    const known = new Set<string>()

    await reconcileGraph(deps, graphOf(['a']), known)

    expect(prefetched).toEqual([])
    expect(loader.created).toEqual([])
    expect(known).toEqual(new Set(['a']))
  })

  it('contains per-row failures: a failed prefetch leaves the row out of the baseline', async () => {
    const loader = makeLoader(['a'])
    const { deps, errors } = makeDeps(loader, new Set(['broken']))
    const known = new Set<string>(['a'])

    await reconcileGraph(deps, graphOf(['a', 'broken']), known)

    expect(loader.created).toEqual([])
    expect(errors.some(message => message.includes('adding graph row "broken" failed'))).toBe(true)
    // The failed row is NOT tracked, so a later retry can attempt it again.
    expect(known).toEqual(new Set(['a']))
  })

  it('creates a fiberless entry with a warning but still tracks it', async () => {
    const loader = makeLoader(['a'], { fiberless: ['noop'] })
    const { deps, warns } = makeDeps(loader)
    const known = new Set<string>(['a'])

    await reconcileGraph(deps, graphOf(['a', 'noop']), known)

    expect(loader.created).toEqual(['noop'])
    expect(warns.some(message => message.includes('created without an active fiber'))).toBe(true)
    expect(known).toEqual(new Set(['a', 'noop']))
  })
})
