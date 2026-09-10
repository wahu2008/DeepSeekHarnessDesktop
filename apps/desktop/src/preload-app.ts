/**
 * Desktop carrier bridge for the main dsh renderer.
 *
 * Upstream exposes only `protocolVersion` to the main renderer. This fork
 * additionally exposes the Settings-owned desktop surfaces: read-only release
 * identity plus http(s) link opening ("About"), the desktop plugin inventory
 * ("Plugins → Desktop plugins"), and the desktop release updater, which the
 * About section drives. The fork also removed the separate management window,
 * so this is the only bridge the desktop shell exposes.
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_IPC,
  type DesktopAboutInfo,
  type DesktopPluginRecord,
  type DesktopUpdateState,
  type DshDesktopApi,
} from './ipc.ts'

const bridge: DshDesktopApi = {
  protocolVersion: 1,
  /** Resolve the desktop release identity for the About settings section. */
  about(): Promise<DesktopAboutInfo> {
    return ipcRenderer.invoke(DESKTOP_IPC.aboutGet) as Promise<DesktopAboutInfo>
  },
  /** Open an http(s) link in the system browser. */
  openExternal(url: string): Promise<boolean> {
    return ipcRenderer.invoke(DESKTOP_IPC.aboutOpenExternal, url) as Promise<boolean>
  },
  plugins: {
    list(): Promise<readonly DesktopPluginRecord[]> {
      return ipcRenderer.invoke(DESKTOP_IPC.pluginsList) as Promise<readonly DesktopPluginRecord[]>
    },
    add(spec: string): Promise<void> {
      return ipcRenderer.invoke(DESKTOP_IPC.pluginsAdd, spec) as Promise<void>
    },
    remove(name: string): Promise<void> {
      return ipcRenderer.invoke(DESKTOP_IPC.pluginsRemove, name) as Promise<void>
    },
    update(name: string, version: string): Promise<void> {
      return ipcRenderer.invoke(DESKTOP_IPC.pluginsUpdate, name, version) as Promise<void>
    },
  },
  updates: {
    check(): Promise<DesktopUpdateState> {
      return ipcRenderer.invoke(DESKTOP_IPC.updatesCheck) as Promise<DesktopUpdateState>
    },
    install(): Promise<void> {
      return ipcRenderer.invoke(DESKTOP_IPC.updatesInstall) as Promise<void>
    },
    subscribe(listener: (state: DesktopUpdateState) => void): () => void {
      const handler = (_event: unknown, state: DesktopUpdateState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.updatesState, handler)
      return () => { ipcRenderer.removeListener(DESKTOP_IPC.updatesState, handler) }
    },
  },
}

export type DshDesktopBridge = DshDesktopApi

contextBridge.exposeInMainWorld('dshDesktop', bridge)
