/**
 * Desktop "About" settings section. Reads the desktop carrier bridge
 * (`window.dshDesktop`), which the Electron preload exposes only in the
 * packaged/Electron carrier — a bare browser `dsh web` has none, so this
 * section renders nothing there. Shows the app name / version / runtime /
 * base build / data directory / repository.
 *
 * The fork also moved the desktop update check here: the shell installs no
 * application menu any more, so "Check for Updates" is a control on this page
 * instead of a menu item. Every shell-published update state is rendered
 * inline, including the one a boot-time prompt would otherwise put in a
 * native dialog.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AboutSection.module.css'

/** Shape of the desktop main-process `aboutGet()` result. */
interface DshAboutInfo {
  name: string
  version: string
  electron: string
  node: string
  platform: string
  basis: string
  repoUrl: string
  dshHome: string
}

/** Shell-published desktop release update state. */
interface DshUpdateState {
  phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  version?: string
  message?: string
}

/** Desktop update operations exposed by the shell. */
interface DshUpdatesBridge {
  check(): Promise<DshUpdateState>
  install(): Promise<void>
  subscribe(listener: (state: DshUpdateState) => void): () => void
}

/** The desktop carrier bridge exposed by the Electron preload. Absent in a bare browser web host. */
interface DshAppBridge {
  about(): Promise<DshAboutInfo>
  openExternal(url: string): Promise<boolean>
  readonly updates: DshUpdatesBridge
}

declare global {
  interface Window {
    /** Present only in the Electron desktop carrier; undefined in a browser web host. */
    dshDesktop?: DshAppBridge & { readonly protocolVersion: 1 }
  }
}

/** Full section props: the settings runtime share + the locales seat. */
export type AboutSectionComponentProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings'>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Render the About section content.
 * @param props - composed slot props (runtime + locale).
 * @returns the section element tree, or null when there is no desktop bridge.
 */
export function AboutSection({ t }: AboutSectionComponentProps) {
  const bridge = typeof window !== 'undefined' ? window.dshDesktop : undefined
  const [info, setInfo] = useState<DshAboutInfo | null>(null)
  const [update, setUpdate] = useState<DshUpdateState>({ phase: 'idle' })
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (bridge?.about === undefined) return
    let alive = true
    void bridge.about().then((value) => { if (alive) setInfo(value) }).catch(() => {})
    return () => { alive = false }
  }, [bridge])

  // The shell publishes every phase change, so a check started here — or by the
  // boot-time prompt — keeps this page in step without polling. 'idle' alone is
  // ambiguous (never checked vs. checked and current), so only a phase the shell
  // reaches by actually checking makes the page claim the release is current.
  useEffect(() => {
    if (bridge?.updates === undefined) return
    return bridge.updates.subscribe((state) => {
      setUpdate(state)
      if (state.phase !== 'idle') setChecked(true)
    })
  }, [bridge])

  // No desktop bridge (bare browser web host): this page has nothing to show.
  if (bridge?.about === undefined) return null

  const openRepo = (): void => {
    if (info?.repoUrl !== undefined) void bridge.openExternal(info.repoUrl)
  }

  const checkForUpdates = async (): Promise<void> => {
    setBusy(true)
    try {
      setUpdate(await bridge.updates.check())
    } catch (error) {
      setUpdate({ phase: 'error', message: errorMessage(error) })
    } finally {
      setChecked(true)
      setBusy(false)
    }
  }

  const installUpdate = async (): Promise<void> => {
    setBusy(true)
    try {
      await bridge.updates.install()
    } catch (error) {
      setUpdate({ phase: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const updateStatus = (): string => {
    switch (update.phase) {
      case 'checking': return t('about.checking')
      case 'available': return t('about.updateAvailable', { version: update.version ?? '' })
      case 'installing': return t('about.installing', { version: update.version ?? '' })
      case 'ready': return t('about.updateReady')
      case 'error': return t('about.updateFailed', { message: update.message ?? '' })
      default: return t('about.upToDate')
    }
  }

  const value = (label: string, text: string): ReactNode => (
    <div className={css.row} key={label}>
      <div className={css.label}>{label}</div>
      <div className={css.value}>{text}</div>
    </div>
  )

  return (
    <div className={css.section}>
      <div className={css.desc}>{t('about.name')}：{info?.name ?? t('about.name.unknown')}</div>
      {value(t('about.version'), info?.version ?? t('about.version.unknown'))}
      {value(t('about.runtime'), info === null ? '' : `Electron ${info.electron} · Node ${info.node} · ${info.platform}`)}
      {value(t('about.basis'), info?.basis ?? '')}
      {value(t('about.dshHome'), info?.dshHome ?? '')}
      <div className={css.row}>
        <div className={css.label}>{t('about.repo')}</div>
        <div className={css.value}>
          {info?.repoUrl !== undefined
            ? <a className={css.link} href={info.repoUrl} onClick={(e) => { e.preventDefault(); openRepo() }}>{info.repoUrl}</a>
            : t('about.name.unknown')}
        </div>
      </div>
      <div className={css.row}>
        <div className={css.label}>{t('about.updates')}</div>
        <div className={css.value}>
          <div className={css.updateRow}>
            <button
              type="button"
              className={css.button}
              disabled={busy || update.phase === 'checking' || update.phase === 'installing'}
              onClick={() => { void checkForUpdates() }}
            >
              {t('about.checkUpdates')}
            </button>
            {update.phase === 'available'
              ? (
                <button
                  type="button"
                  className={css.buttonPrimary}
                  disabled={busy}
                  onClick={() => { void installUpdate() }}
                >
                  {t('about.installAndRestart')}
                </button>
              )
              : null}
          </div>
          <div className={css.updateStatus} role="status" aria-live="polite">{checked ? updateStatus() : ''}</div>
        </div>
      </div>
    </div>
  )
}
