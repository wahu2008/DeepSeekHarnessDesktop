/** Typed bridge operations exposed to the dsh renderer by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'

export type { DesktopPluginRecord }

/**
 * IPC channel names kept private to the desktop application bundle.
 *
 * The fork removed the separate management window (and its `shell` renderer),
 * so every channel is reached from the main dsh renderer the desktop carrier
 * loads at `dsh-app://app/` — plugin management and update checks now live in
 * the Settings surface of that renderer.
 */
export const DESKTOP_IPC = {
  pluginsList: 'dsh-desktop:plugins-list',
  pluginsAdd: 'dsh-desktop:plugins-add',
  pluginsRemove: 'dsh-desktop:plugins-remove',
  pluginsUpdate: 'dsh-desktop:plugins-update',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
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

/** Desktop plugin inventory operations backed by the desktop profile. */
export interface DesktopPluginsApi {
  list(): Promise<readonly DesktopPluginRecord[]>
  add(spec: string): Promise<void>
  remove(name: string): Promise<void>
  update(name: string, version: string): Promise<void>
}

/** Desktop release update operations backed by the packaged updater. */
export interface DesktopUpdatesApi {
  check(): Promise<DesktopUpdateState>
  install(): Promise<void>
  /** Subscribe to shell-published update state; the result unsubscribes. */
  subscribe(listener: (state: DesktopUpdateState) => void): () => void
}

/**
 * Narrow bridge exposed through context isolation. It is the only surface the
 * dsh renderer gets from the desktop carrier: read-only release identity,
 * http(s) link opening, the desktop plugin inventory, and update control.
 */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  about(): Promise<DesktopAboutInfo>
  openExternal(url: string): Promise<boolean>
  readonly plugins: DesktopPluginsApi
  readonly updates: DesktopUpdatesApi
}
