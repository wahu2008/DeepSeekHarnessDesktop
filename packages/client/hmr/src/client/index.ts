/**
 * client-hmr, browser half: hot-reload driver for client plugin entries.
 *
 * Listens on the host's system SSE channel (`GET /plugins/events`); on a
 * `rebuilt` frame it reloads the entry's bundle and swaps the cordis
 * fiber in place. Every graph entry is a plugin bundle
 * — `immediately` rows differ only in stage-one prefetch (a boot
 * optimization), so all rostered plugin packages share these reload semantics;
 * normal packages (react family, cordis, shell, pure libs) are not entries
 * and shell changes still mean a page reload. Cascade is zero-touch:
 * downstream fibers key their activation epoch on provider fiber uids
 * (vendor/cordis/src/fiber.ts `_refresh`), so replacing a provider fiber
 * re-cascades natively — reloading a data-layer plugin (connection/runtime)
 * cascades into its UI dependents with no HMR-side bookkeeping.
 *
 * Reload order (lazy CJS table): invalidate (drop the stale factory and
 * materialized record) → prefetch (load and register the fresh
 * factory) → registry-first teardown → drain old fiber unload → remove
 * owned `<style data-plugin>` tags → `entry.refresh()` materializes the new
 * factory. Invalidate MUST precede prefetch: a live factory makes prefetch
 * a no-op, and re-executing a bundle over an undeleted registration is a
 * loud duplicate. The swap is safe because execution is pure registration
 * under the lazy model — every module side effect (CSS injection included)
 * lives in the factory closure and runs at materialization, inside
 * refresh(). That also keeps the CSS ordering guarantee: owned styles are
 * removed after the old fiber's disposers drained (SlotCore one-owner
 * unregister) and before materialization re-injects tags under the same
 * stable tag ids.
 *
 * Failure window: if prefetch rejects after invalidate, the module is left
 * unregistered while the OLD fiber keeps running untouched (teardown never
 * started) — degraded but recoverable, the next rebuilt frame retries from
 * scratch. Consistent with the no-rollback policy below. Known dev-only
 * race: a rebuilt frame overlapping a still-in-flight boot arrival shares
 * that arrival's task and may materialize the pre-rebuild bytes; the next
 * rebuilt frame self-heals.
 *
 * Why not the naive `entry.fiber.dispose()` → `entry.refresh()` path:
 * 1. `Entry.fiber` is never cleared on dispose (vendor/loader/src/config/
 *    entry.ts assigns it only in `_init`), so `refresh()` hits its
 *    `if (this.fiber) return` guard and no-ops.
 * 2. A bare `fiber.dispose()` lands in Loader's self-dispose branch
 *    (vendor/loader/src/index.ts `internal/plugin` case 4: the registry
 *    still holds the runtime at emit time), which flags the entry
 *    `disabled: true` — permanently.
 * vendor/hmr's reload skeleton documents the fix: delete the runtime record
 * FIRST (`registry.delete` → case 4 returns early, the entry stays enabled),
 * then rebuild. `entry.fiber` is additionally cleared so
 * `entry.refresh()` re-imports and re-plugins through the Loader's own
 * `_init` (entry-resolved config, automatic `fiber.entry` rebinding) instead
 * of hand-rolling `registry.plugin`. Client entries have exactly one fiber
 * per runtime, so `registry.delete` never collaterally disposes siblings.
 *
 * Self-reload: this plugin is itself a graph entry, so a rebuilt frame may
 * name it. The in-flight reload keeps running in the old bundle's closure
 * (its EventSource closes with the old fiber's effects); the new bundle's
 * apply opens a fresh channel. Frames arriving during the gap are lost —
 * acceptable for the dev channel, the next rebuild renotifies.
 *
 * Failure policy: no rollback. An import failure leaves the entry
 * fiberless (the next rebuilt frame retries from scratch); an apply failure
 * leaves a FAILED fiber for the shell's status projection. Both log loudly.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Entry, Loader } from '@deepseek-ai/cordis-plugin-loader'
import type { PluginsEventFrame } from '../events.ts'
import { EVENTS_ENDPOINT } from '../events.ts'

export type { PluginsEventFrame } from '../events.ts'
export { EVENTS_ENDPOINT } from '../events.ts'

/** Cordis plugin name. */
export const name = 'client-hmr'

/** Required services: the vendored Loader (entry governance) and the client module system (boot provide, service name `modules`). */
export const inject = ['loader', 'modules']

/** Find the loader entry whose module specifier is `id` (entry tree ids are random; the package name lives in `options.name`). */
function findEntry(loader: Loader, id: string): Entry | undefined {
  for (const entry of loader.entries()) {
    if (entry.options.name === id) return entry
  }
  return undefined
}

/** Remove every `<style data-plugin>` tag owned by `id` (attribute compared verbatim — no CSS-selector escaping pitfalls). */
function removeOwnedStyles(id: string): void {
  for (const el of document.querySelectorAll('style[data-plugin]')) {
    if (el.getAttribute('data-plugin') === id) el.remove()
  }
}

/** The loader/modules surface `reconcileGraph` needs (injectable for tests). */
export interface ReconcileDeps {
  loader: Loader
  modLoader: { prefetch(id: string): Promise<void> }
  warn(message: string, ...details: unknown[]): void
  error(message: string, ...details: unknown[]): void
}

/**
 * Reconcile the browser's entry set against a freshly received graph:
 * entries the host added since our last view are prefetched and created;
 * entries the host removed are disposed. Boot already created every row in
 * the connect-time graph, so the first `graph` frame only establishes the
 * baseline (idempotent — create/remove are no-ops for known rows).
 * @param deps - loader, module loader, and log sinks.
 * @param graph - the composed graph from a `graph` frame.
 * @param knownIds - in-out baseline of rows the browser has accepted.
 */
export async function reconcileGraph(
  deps: ReconcileDeps,
  graph: { entries: Array<{ id: string; url?: string; rev?: string }> },
  knownIds: Set<string>,
): Promise<void> {
  const { loader, modLoader, warn, error } = deps
  const next = new Set(graph.entries.map(row => row.id))
  // Removed first: a later removal of a row we are about to create must not
  // race a re-add of the same id (dispose order is one-directional).
  for (const id of [...knownIds]) {
    if (next.has(id)) continue
    const entry = findEntry(loader, id)
    if (entry !== undefined) {
      try {
        await loader.remove(entry.id)
      } catch (removalError) {
        warn(`client-hmr: removing graph row "${id}" failed`)
        warn(removalError instanceof Error ? removalError.message : String(removalError))
      }
    }
    knownIds.delete(id)
  }
  for (const row of graph.entries) {
    if (knownIds.has(row.id)) continue
    const entry = findEntry(loader, row.id)
    if (entry !== undefined) {
      // Boot created it (or a prior frame already did): just track it.
      knownIds.add(row.id)
      continue
    }
    try {
      // Prefetch first so the factory is registered before the Loader
      // materializes it during entry creation (same ordering as boot).
      await modLoader.prefetch(row.id)
      const created = await loader.create({ name: row.id })
      const createdEntry = loader.resolve(created)
      if (createdEntry?.fiber === undefined) {
        warn(`client-hmr: graph row "${row.id}" created without an active fiber`)
      }
      knownIds.add(row.id)
    } catch (createError) {
      error(`client-hmr: adding graph row "${row.id}" failed`)
      error(createError instanceof Error ? createError.message : String(createError))
    }
  }
}

/**
 * Mount the HMR driver: subscribe to the system SSE channel and hot-swap
 * rebuilt entries.
 * @param ctx - plugin context with `loader` and `modules` available.
 */
export function apply(ctx: Context): void {
  // Both are declared injections (typed Context merges: `modules` from the
  // client module loader package, `loader` from the vendored Loader).
  const modLoader = ctx.modules
  const loader: Loader = ctx.loader

  // Live graph reconciliation baseline: every row the browser has already
  // accepted (boot rows plus rows added through prior `graph` frames). Used
  // to diff incoming graphs for add/remove without re-creating boot rows.
  const knownIds = new Set<string>()

  async function reload(id: string): Promise<void> {
    const entry = findEntry(loader, id)
    if (entry === undefined) {
      ctx.logger.warn(`client-hmr: rebuilt frame for unknown entry "${id}" (not in the loader tree)`)
      return
    }
    // Invalidate first (drop stale factory + record — a live factory makes
    // prefetch a no-op and re-registration a loud duplicate), then run the
    // async half while the old fiber still serves: script loading registers
    // the fresh factory with zero side effects (lazy CJS — module bodies run
    // at materialization, not execution).
    modLoader.invalidate(id)
    await modLoader.prefetch(id)

    const oldFiber = entry.fiber
    if (oldFiber !== undefined) {
      // Registry-first teardown (see module comment): the runtime record must
      // be gone before the fiber's disposer emits internal/plugin, or the
      // Loader flags the entry disabled.
      const runtime = oldFiber.runtime
      if (runtime !== null) entry.ctx.registry.delete(runtime.callback)
      // Drain the unload: effect disposers (slots, subscriptions) must finish
      // before the new bundle executes and the new apply re-registers.
      while (oldFiber.inertia !== undefined) await oldFiber.inertia
      delete entry.fiber
    }
    // Old owned styles go before materialization re-injects them (the CSS
    // idempotency guard keys on stable tag ids).
    removeOwnedStyles(id)
    // Re-init through the entry: fiber cleared above, so refresh() re-imports
    // — materializing the prefetched factory (CSS injects here) — and
    // re-plugins under the entry context. Import failures are logged by
    // Entry._init and leave the entry fiberless (retryable).
    await entry.refresh()
    // Surface apply failures loudly (no rollback, FAILED state stays).
    await entry.fiber?.await()
  }

  // Serialize reloads: frames can arrive faster than a swap completes, and
  // interleaved dispose/execute chains would corrupt the single-slot handoff.
  let queue: Promise<void> = Promise.resolve()
  const handle = (frame: PluginsEventFrame): void => {
    switch (frame.type) {
      case 'rebuilt':
        queue = queue.then(() => reload(frame.id)).catch((error: unknown) => {
          ctx.logger.error(`client-hmr: reload of "${frame.id}" failed`)
          ctx.logger.error(error)
        })
        break
      case 'graph':
        // Live graph reconciliation: rows hot-added by the host (`dsh plugin
        // add` activating a new bundle layer) arrive here; rows removed by the
        // host are disposed. The connect-time snapshot establishes the
        // baseline against boot-created entries.
        queue = queue.then(() => reconcileGraph(
          {
            loader,
            modLoader,
            warn: (message, ...details) => ctx.logger.warn(message, ...details),
            error: (message, ...details) => ctx.logger.error(message, ...details),
          },
          frame.graph,
          knownIds,
        )).catch((error: unknown) => {
          ctx.logger.error('client-hmr: graph reconciliation failed')
          ctx.logger.error(error)
        })
        break
      default:
        // Merge-extensible frame union: unknown frame types from newer hosts
        // are ignored by design.
        break
    }
  }

  ctx.effect(() => {
    const source = new EventSource(EVENTS_ENDPOINT)
    source.addEventListener('message', (event: MessageEvent<string>) => {
      let frame: PluginsEventFrame
      try {
        frame = JSON.parse(event.data) as PluginsEventFrame
      } catch {
        // Wire boundary: a malformed dev-channel frame is dropped loudly.
        ctx.logger.warn(`client-hmr: unparseable event frame: ${event.data}`)
        return
      }
      handle(frame)
    })
    return () => { source.close() }
  }, 'client-hmr: event source')
}
