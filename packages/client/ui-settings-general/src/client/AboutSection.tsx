/**
 * Desktop "About" settings section. Reads the desktop carrier bridge
 * (`window.dshDesktop`), which the Electron preload exposes only in the
 * packaged/Electron carrier — a bare browser `dsh web` has none, so this
 * section renders nothing there. Shows the app name / version / runtime /
 * base build / data directory / repository.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AboutSection.module.css'

/** The desktop carrier bridge exposed by the Electron preload. Absent in a bare browser web host. */
interface DshAppBridge {
  about(): Promise<DshAboutInfo>
  openExternal(url: string): Promise<boolean>
}

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

/**
 * Render the About section content.
 * @param props - composed slot props (runtime + locale).
 * @returns the section element tree, or null when there is no desktop bridge.
 */
export function AboutSection({ t }: AboutSectionComponentProps) {
  const bridge = typeof window !== 'undefined' ? window.dshDesktop : undefined
  const [info, setInfo] = useState<DshAboutInfo | null>(null)

  useEffect(() => {
    if (bridge?.about === undefined) return
    let alive = true
    void bridge.about().then((value) => { if (alive) setInfo(value) }).catch(() => {})
    return () => { alive = false }
  }, [bridge])

  // No desktop bridge (bare browser web host): this page has nothing to show.
  if (bridge?.about === undefined) return null

  const openRepo = (): void => {
    if (info?.repoUrl !== undefined) void bridge.openExternal(info.repoUrl)
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
    </div>
  )
}
