/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { resolveDesktopPaths } from './paths.ts'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DesktopProjectManager, type DesktopProjectHooks } from './project-manager.ts'
import { DesktopHostProcess } from './host-process.ts'
import {
  DESKTOP_IPC,
  type DesktopAboutInfo,
  type DesktopUpdateState,
} from './ipc.ts'
import { formatDesktopMessage, resolveDesktopLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'

const SCHEME = 'dsh-app'
// Fork extension: About-section release identity. The repo URL points at the
// fork; the basis records the official dsh release this desktop build replays.
const APP_REPO_URL = 'https://github.com/wahu2008/DeepSeekHarnessDesktop'
const APP_BASIS = 'deepseek-harness dsh 0.1.5-alpha.1'
let focusPrimaryWindow = (): void => {}

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
    codeCache: true,
  },
}])

interface RuntimeResources {
  readonly node: string
  readonly pnpm: string
  readonly seed: string
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = (development ? process.env.DSH_DESKTOP_NODE_BINARY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  const seed = (development ? process.env.DSH_DESKTOP_SEED_DIR : undefined) ?? join(process.resourcesPath, 'seed')
  return { node, pnpm, seed }
}

function developmentProject(): string | undefined {
  const configured = process.env.DSH_DESKTOP_DEV_PROJECT_DIR
  if (configured === undefined || configured === '') return undefined
  if (app.isPackaged) throw new Error('dsh desktop: development project override is unavailable in packaged applications')
  return resolve(configured)
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

function createWindow(preload: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).protocol !== `${SCHEME}:`) event.preventDefault()
  })
  return window
}

function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('dsh desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
}

async function main(): Promise<void> {
  const resources = runtimeResources()
  const paths = resolveDesktopPaths()
  const development = developmentProject()
  const activeProject = development ?? paths.profile
  const hostInspectPort = developmentHostInspectPort(development !== undefined)
  const manager = new DesktopProjectManager(paths, resources)
  if (development === undefined) manager.recover()
  let host: DesktopHostProcess | undefined
  let mainWindow: BrowserWindow | undefined
  let shellInstallerOwnsQuit = false
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const locale = resolveDesktopLocale(app.getLocale())
  const messages = locale.messages
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))

  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateState = state
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesState, state)
    }
    return state
  }

  const startHost = async (projectDir = activeProject): Promise<DesktopHostProcess> => {
    const next = new DesktopHostProcess(resources.node, projectDir, hostInspectPort)
    await next.start()
    return next
  }
  const hooks: DesktopProjectHooks = {
    healthCheck: async (projectDir) => {
      const active = host
      host = undefined
      await active?.stop()
      let healthFailure: unknown
      let probe: DesktopHostProcess | undefined
      try {
        probe = await startHost(projectDir)
        await probe.stop()
      } catch (error) {
        healthFailure = error
        await probe?.stop().catch(() => undefined)
      }
      let restartFailure: unknown
      if (active !== undefined) {
        try {
          host = await startHost()
        } catch (error) {
          restartFailure = error
        }
      }
      if (healthFailure !== undefined && restartFailure !== undefined) {
        throw new AggregateError([
          errorOf(healthFailure, 'desktop project: staged health check failed'),
          errorOf(restartFailure, 'desktop project: active backend restart failed'),
        ], 'desktop project: staged health check and active backend restart failed')
      }
      if (healthFailure !== undefined) throw errorOf(healthFailure, 'desktop project: staged health check failed')
      if (restartFailure !== undefined) throw errorOf(restartFailure, 'desktop project: active backend restart failed')
    },
    beforeActivate: async () => {
      const active = host
      host = undefined
      await active?.stop()
    },
    afterActivate: async () => {
      host = await startHost()
    },
  }

  if (development === undefined) {
    await manager.applyRelease(resources.seed, app.getVersion(), {
      ...hooks,
      beforeActivate: async () => {},
      afterActivate: async () => {},
    })
  }
  host = await startHost()

  const updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      shellInstallerOwnsQuit = true
      const active = host
      host = undefined
      await active?.stop()
    },
  )

  // The fork serves only the dsh renderer; the separate management window and
  // its `shell` host are gone, so `dsh-app://app/` is the only owned origin.
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }))
    const active = host
    if (active === undefined) return Promise.resolve(new Response('backend unavailable', { status: 503 }))
    return active.fetch(request)
  })

  const mutate = async (event: IpcMainInvokeEvent, mutation: Parameters<DesktopProjectManager['mutate']>[0]): Promise<void> => {
    assertDesktopSender(event, ['app'])
    if (development !== undefined) {
      throw new Error('dsh desktop: plugin package changes require a packaged application')
    }
    await manager.mutate(mutation, hooks)
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
  }
  ipcMain.handle(DESKTOP_IPC.pluginsList, (event) => {
    assertDesktopSender(event, ['app'])
    if (development !== undefined) return []
    return manager.listPlugins()
  })
  ipcMain.handle(DESKTOP_IPC.pluginsAdd, (event, spec: unknown) => {
    if (typeof spec !== 'string') throw new Error('dsh desktop: plugin spec must be a string')
    return mutate(event, { type: 'plugin-add', spec })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsRemove, (event, name: unknown) => {
    if (typeof name !== 'string') throw new Error('dsh desktop: plugin name must be a string')
    return mutate(event, { type: 'plugin-remove', name })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsUpdate, (event, name: unknown, version: unknown) => {
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error('dsh desktop: plugin name and version must be strings')
    }
    return mutate(event, { type: 'plugin-update', name, version })
  })
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (event) => {
    assertDesktopSender(event, ['app'])
    return updates.check()
  })
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (event) => {
    assertDesktopSender(event, ['app'])
    await updates.install()
  })
  // Fork extension: About-section data for the main dsh renderer. Read-only
  // release identity and http(s) link opening, matching the AboutSection
  // contract that the fork replays from its earlier desktop shell.
  ipcMain.handle(DESKTOP_IPC.aboutGet, (event): DesktopAboutInfo => {
    assertDesktopSender(event, ['app'])
    return {
      name: 'DeepSeek Harness Desktop',
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      basis: APP_BASIS,
      repoUrl: APP_REPO_URL,
      dshHome: resolveDshHome(),
    }
  })
  ipcMain.handle(DESKTOP_IPC.aboutOpenExternal, (event, url: unknown): boolean => {
    assertDesktopSender(event, ['app'])
    if (typeof url !== 'string') return false
    const target = new URL(url)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return false
    void shell.openExternal(target.toString())
    return true
  })

  // Updates are driven from Settings → About. The shell still checks once
  // after boot and speaks up only when a release really is available, so a
  // user who never opens About still learns about one.
  const promptForAvailableUpdate = async (): Promise<void> => {
    const state = await updates.check()
    if (state.phase !== 'available') return
    const result = await dialog.showMessageBox({
      type: 'info',
      title: messages.updateTitle,
      message: messages.updateAvailable,
      detail: formatDesktopMessage(messages.updateDetail, { version: state.version ?? '' }),
      buttons: [messages.installAndRestart, messages.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response !== 0) return
    const installed = await updates.install()
    if (installed.phase === 'error') {
      await dialog.showMessageBox({
        type: 'error',
        title: messages.updateFailedTitle,
        message: installed.message ?? messages.unknownError,
      })
    }
  }

  // Fork behavior: no Desktop-owned application menu. The upstream menu carried
  // the desktop plugin manager and the update check, and both moved into the dsh
  // Settings surface (Plugins → Desktop plugins, and About), so Windows and
  // Linux install no menu bar at all and the window keeps only its own title-bar
  // controls. macOS keeps the standard roles its system shortcuts require
  // (clipboard, quit, window management); none of them opens a Desktop surface.
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    : null)

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload)
    mainWindow = window
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
    window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
    return window
  }
  focusPrimaryWindow = () => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) {
      const replacement = createMainWindow()
      void replacement.loadURL(`${SCHEME}://app/index.html`)
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  mainWindow = createMainWindow()
  await mainWindow.loadURL(`${SCHEME}://app/index.html`)
  if (development !== undefined && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
  setTimeout(() => { void promptForAvailableUpdate() }, 10_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) focusPrimaryWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (shellInstallerOwnsQuit) return
    if (host === undefined) return
    event.preventDefault()
    const active = host
    host = undefined
    void active.stop().finally(() => { app.quit() })
  })
}

const ownsDesktopInstance = claimDesktopSingleInstance(app, () => { focusPrimaryWindow() })

if (ownsDesktopInstance) void app.whenReady().then(main).catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  const diagnosticFile = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
  if (diagnosticFile !== undefined) {
    await writeFile(diagnosticFile, `${error instanceof Error ? error.stack ?? message : message}\n`).catch(() => undefined)
  }
  dialog.showErrorBox(resolveDesktopLocale(app.getLocale()).messages.startupFailed, message)
  app.exit(1)
})
