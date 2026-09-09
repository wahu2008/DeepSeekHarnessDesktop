/**
 * Minimal marker that selects the desktop custom-protocol API carrier.
 *
 * Upstream exposes only `protocolVersion` to the main dsh renderer. This fork
 * additionally exposes a read-only About bridge (release identity plus opening
 * http(s) links) so the web settings "About" section works inside the desktop
 * carrier. It performs no plugin mutation and grants no filesystem access.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DesktopAboutInfo } from './ipc.ts'

const aboutBridge = {
  protocolVersion: 1,
  /** Resolve the desktop release identity for the About settings section. */
  about(): Promise<DesktopAboutInfo> {
    return ipcRenderer.invoke(DESKTOP_IPC.aboutGet) as Promise<DesktopAboutInfo>
  },
  /** Open an http(s) link in the system browser. */
  openExternal(url: string): Promise<boolean> {
    return ipcRenderer.invoke(DESKTOP_IPC.aboutOpenExternal, url) as Promise<boolean>
  },
}

export type DshAboutBridge = typeof aboutBridge

contextBridge.exposeInMainWorld('dshDesktop', aboutBridge)
