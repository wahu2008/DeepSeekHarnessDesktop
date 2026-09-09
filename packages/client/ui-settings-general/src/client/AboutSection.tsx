/**
 * Desktop "About" settings section. Reads the desktop shell bridge
 * (`window.__DSH_APP__`), which the Electron preload exposes only in the
 * packaged/Electron carrier — a bare browser `dsh web` has none, so this
 * section renders nothing there. Shows the app name / version / runtime /
 * base build / data directory / repository, plus a "Check for updates" action
 * backed by the host's `app:check-update` and `app:open-external` IPC.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AboutSection.module.css'

/** The desktop shell bridge exposed by the Electron preload. Absent in a bare browser web host. */
interface DshAppBridge {
  about(): Promise<DshAboutInfo>
  checkUpdate(): Promise<DshUpdateResult>
  openExternal(url: string): Promise<boolean>
}

/** Shape of `apps/desktop` main process `aboutInfo()`. */
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

/** Shape of `apps/desktop` main process `checkForUpdates()` result. */
interface DshUpdateResult {
  status: 'current' | 'update' | 'none' | 'error'
  currentVersion?: string
  latestVersion?: string
  releaseUrl?: string
  name?: string
  publishDate?: string
  message?: string
}

declare global {
  interface Window {
    /** Present only in the Electron desktop carrier; undefined in a browser web host. */
    __DSH_APP__?: DshAppBridge
  }
}

/** Full section props: the settings runtime share + the locales seat. */
export type AboutSectionComponentProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings'>

/**
 * Render the About section content.
 * @param props - composed slot props (runtime + locale).
 * @returns the section element tree, or null when there is no desktop bridge.
 */
export function AboutSection({ t }: AboutSectionComponentProps) {
  const bridge = typeof window !== 'undefined' ? window.__DSH_APP__ : undefined
  const [info, setInfo] = useState<DshAboutInfo | null>(null)
  const [update, setUpdate] = useState<DshUpdateResult | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (bridge === undefined) return
    let alive = true
    void bridge.about().then((value) => { if (alive) setInfo(value) }).catch(() => {})
    return () => { alive = false }
  }, [bridge])

  // No desktop bridge (bare browser web host): this page has nothing to show.
  if (bridge === undefined) return null

  const checkUpdate = (): void => {
    if (checking) return
    setChecking(true)
    void bridge.checkUpdate()
      .then((value) => { setUpdate(value) })
      .finally(() => { setChecking(false) })
  }

  const openRepo = (): void => {
    if (info?.repoUrl !== undefined) void bridge.openExternal(info.repoUrl)
  }

  const openRelease = (): void => {
    if (update?.releaseUrl !== undefined) void bridge.openExternal(update.releaseUrl)
  }

  const updateLabel = (): string => {
    if (checking) return t('about.update.checking')
    if (update === null) return t('about.update.action')
    switch (update.status) {
      case 'current':
        return t('about.update.current')
      case 'update':
        return `${t('about.update.available')} ${update.latestVersion ?? ''}`
      case 'none':
        return t('about.update.none')
      case 'error':
        return t('about.update.error')
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
      <div className={css.actions}>
        <Button size="sm" className={css.button} onClick={checkUpdate} disabled={checking}>
          {updateLabel()}
        </Button>
        {update?.status === 'update' && update.releaseUrl !== undefined && (
          <Button size="sm" className={css.button} onClick={openRelease}>
            {t('about.update.download')}
          </Button>
        )}
      </div>
    </div>
  )
}
