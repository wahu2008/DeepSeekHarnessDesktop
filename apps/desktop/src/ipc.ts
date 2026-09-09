/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: 'dsh-desktop:locale-get',
  pluginsList: 'dsh-desktop:plugins-list',
  pluginsAdd: 'dsh-desktop:plugins-add',
  pluginsRemove: 'dsh-desktop:plugins-remove',
  pluginsUpdate: 'dsh-desktop:plugins-update',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
  // Fork extension: read-only "About" data for the main renderer. The main
  // dsh renderer upstream receives only the desktop protocol marker; this fork
  // additionally lets it read release identity and open http(s) links, keeping
  // the marker's read-only posture (no plugin mutation, no filesystem).
  aboutGet: 'dsh-desktop:about-get',
  aboutOpenExternal: 'dsh-desktop:about-open-external',
} as const

/**
 * Desktop release identity rendered by the main-window "About" settings
 * section. Values are static strings resolved in the main process.
 */
export interface DesktopAboutInfo {
  readonly name: string
  readonly version: string
  readonly electron: string
  readonly node: string
  readonly platform: string
  readonly basis: string
  readonly repoUrl: string
  readonly dshHome: string
}

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/** Narrow bridge exposed through context isolation. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
}
