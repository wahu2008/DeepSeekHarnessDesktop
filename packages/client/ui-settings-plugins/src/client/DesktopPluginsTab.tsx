/**
 * Desktop Plugins tab inside the shared Plugins settings section.
 *
 * The fork removed the shell's separate plugin-manager window and its
 * application menu, so this tab is where the desktop profile's npm plugins are
 * installed, updated, and removed. It talks to `window.dshDesktop.plugins`,
 * which the desktop preload exposes only inside the Electron carrier; a bare
 * browser `dsh web` has no such bridge, so the tab is not registered there.
 *
 * Every mutation runs in the Electron main process against a staging project
 * and then reloads this renderer, so the list is read back rather than patched
 * locally.
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DesktopPluginsTab.module.css'

/** One installed desktop plugin as reported by the main process. */
interface DesktopPluginRecord {
  name: string
  version: string
}

/** Desktop plugin inventory operations exposed by the shell. */
interface DshPluginsBridge {
  list(): Promise<readonly DesktopPluginRecord[]>
  add(spec: string): Promise<void>
  remove(name: string): Promise<void>
  update(name: string, version: string): Promise<void>
}

/** Props the renderer binds for the desktop tab. */
export type DesktopPluginsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>

/**
 * Read the desktop plugin bridge without declaring the carrier global here: the
 * settings shell already owns that declaration. The cast bridges to it so the
 * carrier type keeps a single source of truth.
 * @returns the plugin bridge, or undefined in a bare browser web host.
 */
export function resolveDesktopPlugins(): DshPluginsBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const carrier = (window as unknown as { dshDesktop?: { plugins?: DshPluginsBridge } }).dshDesktop
  return carrier?.plugins
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render the desktop plugin inventory.
 * @param props - composed slot props (runtime + locale).
 * @returns the tab element tree.
 */
export function DesktopPluginsTab({ t }: DesktopPluginsTabProps) {
  const bridge = resolveDesktopPlugins()
  const [plugins, setPlugins] = useState<readonly DesktopPluginRecord[]>([])
  const [spec, setSpec] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const read = useCallback(async (message: string, done: string): Promise<void> => {
    if (bridge === undefined) return
    setBusy(true)
    setStatus(message)
    try {
      setPlugins(await bridge.list())
      setStatus(done)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [bridge])

  useEffect(() => {
    void read(t('desktopLoading'), '')
  }, [read, t])

  // The tab registers only where the carrier bridge exists; the guard keeps a
  // preload that failed to expose it from rendering a dead panel.
  if (bridge === undefined) return <p className={css.empty}>{t('desktopUnavailable')}</p>

  const mutate = async (operation: () => Promise<void>, message: string): Promise<void> => {
    setBusy(true)
    setStatus(message)
    try {
      await operation()
      setPlugins(await bridge.list())
      setStatus(t('desktopOperationComplete'))
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.tab}>
      <p className={css.intro}>{t('desktopIntro')}</p>
      <form
        className={css.installForm}
        onSubmit={(event) => {
          event.preventDefault()
          const requested = spec.trim()
          if (requested === '') return
          setSpec('')
          void mutate(() => bridge.add(requested), t('desktopInstalling', { spec: requested }))
        }}
      >
        <label className={css.label} htmlFor="desktop-plugin-spec">{t('desktopPackageLabel')}</label>
        <div className={css.installRow}>
          <input
            id="desktop-plugin-spec"
            className={css.input}
            autoComplete="off"
            placeholder="@scope/plugin@1.2.3"
            required
            value={spec}
            onChange={(event) => { setSpec(event.target.value) }}
          />
          <button type="submit" className={css.buttonPrimary} disabled={busy}>{t('desktopInstall')}</button>
          <button
            type="button"
            className={css.button}
            disabled={busy}
            onClick={() => { void read(t('desktopRefreshing'), '') }}
          >
            {t('desktopRefresh')}
          </button>
        </div>
      </form>
      <p className={css.status} role="status" aria-live="polite">{status}</p>
      <section aria-labelledby="desktop-installed-heading">
        <h3 className={css.heading} id="desktop-installed-heading">{t('desktopInstalled')}</h3>
        {plugins.length === 0 ? <p className={css.empty}>{t('desktopEmpty')}</p> : (
          <ul className={css.list}>
            {plugins.map(plugin => (
              <li className={css.item} key={plugin.name}>
                <span className={css.identity}>
                  {plugin.name}
                  <span className={css.version}>{plugin.version}</span>
                </span>
                <span className={css.actions}>
                  <button
                    type="button"
                    className={css.button}
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt(t('desktopTargetVersion', { name: plugin.name }), plugin.version)?.trim()
                      if (next === undefined || next === '' || next === plugin.version) return
                      void mutate(() => bridge.update(plugin.name, next), t('desktopUpdating', { name: plugin.name }))
                    }}
                  >
                    {t('desktopUpdate')}
                  </button>
                  <button
                    type="button"
                    className={css.button}
                    disabled={busy}
                    onClick={() => { void mutate(() => bridge.remove(plugin.name), t('desktopRemoving', { name: plugin.name })) }}
                  >
                    {t('desktopRemove')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
