/**
 * Electron main process for the desktop shell (thin-shell carrier).
 *
 * The DeepSeek Harness host CANNOT run inside Electron's main process: its
 * vendored Loader resolves bare plugin packages through `node-addon-require-
 * builtin` → `node-addon-native-custom-loader`, a native addon compiled for the
 * Node ABI and therefore unavailable under Electron's ABI. So the shell spawns
 * the real `dsh web` host under system Node (where the Loader works) and loads
 * the served UI. The native IPC carrier (mountIpcHost + IpcApiClient) is
 * already landed and unit-tested for when the Loader-under-Electron limitation
 * is lifted; this shell uses the HTTP/WebSocket carrier until then.
 *
 * Host-restart resilience (plugin installs without manual app restarts):
 * the shell pins one persistent port (stored under userData) instead of
 * `--port 0`, so a plugin-manager self-restart that re-spawns the host
 * (e.g. dshmarket's /dsh-market/restart, which re-invokes the exact CLI
 * argv) rebinds the SAME port and the existing window can simply reload.
 * When the host child exits after a successful boot, the shell waits for
 * that port to be reclaimed (the plugin manager's replacement host), then
 * reloads the window; if nobody claims it, the shell spawns a replacement
 * itself. On quit, any orphan host process bound to our port is killed so
 * the next launch never collides with a leftover.
 *
 * Runs under `electron .` after `pnpm install` + `pnpm build`.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Dev resolves the CLI from the workspace and spawns system `node`; the
// packaged app resolves both from `process.resourcesPath` (electron-builder
// extraResources: `dsh/` and `node/`).
const resourcesPath = process.resourcesPath
const dshRoot = resourcesPath !== undefined
  ? join(resourcesPath, 'dsh')
  : dirname(require.resolve('@deepseek-ai/dsh/package.json'))
const CLI_ENTRY = join(dshRoot, 'lib', 'bin.js')
const NODE_BIN = resourcesPath !== undefined
  ? join(resourcesPath, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  : process.env.DSH_DESKTOP_NODE ?? 'node'

let child: ChildProcess | undefined
let mainWindow: BrowserWindow | undefined
let logPath = ''
let dshHome = ''
let hostPort = 0
let quitting = false
let recovering = false

function log(line: string): void {
  const ts = new Date().toISOString()
  if (logPath) {
    try {
      appendFileSync(logPath, `[${ts}] ${line}\n`)
    } catch {
      /* logging must never take the app down */
    }
  }
}

/** File that persists the pinned host port across app restarts. */
function portFile(): string {
  return join(app.getPath('userData'), 'dsh-host-port')
}

/** Find a free TCP port on 127.0.0.1 (0 means failure). */
function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(0))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** True when something accepts TCP connections on 127.0.0.1:port. */
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (value: boolean): void => {
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(500, () => done(false))
  })
}

/**
 * Pick the pinned port: reuse the persisted one when it is still free,
 * otherwise allocate a fresh free port and persist it. The pin lets a
 * plugin-manager self-restart rebind the same port, so the window URL never
 * changes.
 */
async function resolveHostPort(): Promise<void> {
  const file = portFile()
  try {
    const previous = Number(readFileSync(file, 'utf8').trim())
    if (Number.isInteger(previous) && previous > 0 && previous < 65536 && !(await isPortOpen(previous))) {
      hostPort = previous
      log(`reusing pinned port ${hostPort}`)
      return
    }
  } catch {
    /* no pin yet — first run */
  }
  const free = await findFreePort()
  hostPort = free > 0 ? free : 3080
  try {
    writeFileSync(file, String(hostPort), 'utf8')
  } catch {
    /* persistence is best-effort */
  }
  log(`pinned host port ${hostPort}`)
}

/** Spawn `dsh web` under system Node and resolve its printed URL. */
function spawnHost(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!existsSync(CLI_ENTRY)) {
      reject(new Error(`CLI entry missing (${CLI_ENTRY}); run pnpm run build first`))
      return
    }
    log(`spawning: ${NODE_BIN} ${CLI_ENTRY} --profile web --port ${hostPort} --no-open (DSH_HOME=${dshHome})`)
    // --no-open: the shell IS the UI; without it dsh web also launches the
    // system default browser, duplicating the window on every start.
    const proc = spawn(NODE_BIN, [CLI_ENTRY, '--profile', 'web', '--port', String(hostPort), '--no-open'], {
      env: { ...process.env, DSH_HOME: dshHome, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child = proc
    let settled = false
    let buffer = ''
    let stderrTail = ''
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error(`host startup timed out after 90s. Last stderr: ${stderrTail || '(none)'}`))
      }
    }, 90_000)
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      log('HOST-OUT: ' + chunk.toString('utf8').trimEnd())
      const match = buffer.match(/dsh web: (\S+)/)
      if (!settled && match !== null) {
        settled = true
        clearTimeout(timeout)
        resolve(match[1])
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', (chunk) => {
      const line = chunk.toString('utf8')
      stderrTail = (stderrTail + line).slice(-2000)
      log('HOST-ERR: ' + line.trimEnd())
    })
    proc.on('error', (error) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
    })
    proc.on('exit', (code) => {
      child = undefined
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(new Error(`host exited early (code ${String(code)}). Last stderr: ${stderrTail || '(none)'}`))
        return
      }
      // Boot succeeded earlier: this exit is a plugin-manager self-restart
      // or a crash. On app quit we already asked the host to stop.
      if (quitting) return
      log(`host exited (code ${String(code)}) after being ready; recovering`)
      void recoverHost()
    })
  })
}

/** Reload the window against a URL, retrying briefly while the host settles. */
async function loadWindow(url: string): Promise<void> {
  if (mainWindow === undefined) return
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await mainWindow.loadURL(url)
      log(`window loaded ${url}`)
      // Inject the frameless custom title bar. `did-finish-load` fires DURING
      // loadURL and is already past when it resolves, so register dom-ready
      // too AND run directly — the injection retries until document.body
      // exists. It is painted with the Web UI theme vars so a skin change
      // recolors it.
      const injectNow = (): void => {
        log('injecting titlebar')
        void mainWindow?.webContents.executeJavaScript(INJECT_TITLEBAR).then(
          () => log('titlebar inject resolved'),
          err => log('titlebar inject REJECTED: ' + (err && err.message)),
        ).finally(() => {
          void mainWindow?.webContents.executeJavaScript(
            'JSON.stringify(window.__DSH_TITLEBAR_DEBUG__ === undefined ? { injected:false } : window.__DSH_TITLEBAR_DEBUG__)',
          ).then(
            dbg => log('titlebar debug: ' + dbg),
            err => log('titlebar debug read error: ' + (err && err.message)),
          )
        })
      }
      mainWindow.webContents.once('did-finish-load', () => { log('did-finish-load fired'); injectNow() })
      mainWindow.webContents.once('dom-ready', () => { log('dom-ready fired'); injectNow() })
      injectNow()
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  log(`window reload failed after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

/**
 * Title-bar injection source (CSS + DOM + JS). All colors bind the Web UI
 * theme tokens (`--dsw-alias-*`), so switching skin/theme recolors the title
 * bar plus the window buttons. `-webkit-app-region: drag` lets the bar drag
 * the window; the button cluster is `no-drag`.
 */
const INJECT_TITLEBAR = String.raw`
(function () {
  const id = 'dsh-desktop-titlebar'
  function run() {
    if (!document.body) { setTimeout(run, 100); return }
    if (document.getElementById(id)) { window.__DSH_TITLEBAR_DEBUG__ = { injected: true, reason: 'already-present' }; return }
    const style = document.createElement('style')
    style.id = id + '-css'
    style.textContent = [
      '.' + id + '{position:fixed;top:0;left:0;right:0;height:32px;display:flex;align-items:center;justify-content:space-between;',
        'background:var(--dsw-alias-bg-module-platform, #1b1f27);color:var(--dsw-alias-label-primary, #d0d4dc);',
        '-webkit-app-region:drag;z-index:2147483647;user-select:none;overflow:hidden;}',
      '.' + id + ' .tb-title{display:flex;align-items:center;gap:8px;padding-left:12px;font-size:12px;font-weight:500;letter-spacing:.2px;}',
      '.' + id + ' .tb-title .tb-mark{display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-primary, #d0d4dc);}',
      '.' + id + ' .tb-title .tb-mark svg{display:block;}',
      '.' + id + ' .tb-actions{display:flex;-webkit-app-region:no-drag;height:100%;}',
      '.' + id + ' .tb-actions button{width:46px;height:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary, #d0d4dc);cursor:default;font-size:12px;display:flex;align-items:center;justify-content:center;outline:none;}',
      '.' + id + ' .tb-actions button:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));}',
      '.' + id + ' .tb-actions .tb-close:hover{background:#e81123;color:#fff;}',
      // Do NOT grow body (that creates a page scrollbar and pushes the
      // default view off-screen). Instead: lock body scroll, and shift the
      // app root (#root hosts AppFrame) down by the bar height while shrinking
      // its height so it ends exactly at the viewport bottom.
      'html{height:100%;overflow:hidden;}',
      'body{height:100vh;overflow:hidden;margin:0 !important;padding:0 !important;}',
      '#root{height:calc(100vh - 32px) !important;margin-top:32px !important;overflow:hidden;}',
    ].join('\n')
    document.head.append(style)
    const bar = document.createElement('div')
    bar.className = id
    bar.id = id
    bar.innerHTML = [
      '<span class="tb-title"><span class="tb-mark"><svg width="18" height="14" viewBox="0 0 23.16 17.04" fill="currentColor" aria-hidden="true"><path d="M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.5961C6.9851 15.58 6.22237 15.5871 5.54037 14.5701C4.28283 12.791 3.70982 10.812 3.71932 8.833C3.72482 7.379 4.03633 6.001 4.83536 4.741C5.16586 4.20049 5.51886 3.67598 5.90137 3.16998C6.10538 3.05148 6.29038 2.91597 6.49639 2.65097C7.74243 1.30498 10.7034 0.690 8.61038 2.632C8.08587 3.09601 7.61437 3.619 7.21536 4.189C6.04683 5.843 5.44433 7.748 5.48633 9.757C5.50433 10.646 5.64933 11.517 5.94034 12.367C6.05284 12.675 6.14234 12.572 5.73633 12.049C6.97788 13.646 8.40993 15.022 9.91739 15.955C10.2919 16.156 10.6964 16.303 11.1209 16.393C11.3419 16.438 11.6184 16.555 11.3949 16.272C11.2604 16.102 11.1739 15.906 11.1739 15.681C11.1739 15.406 11.1749 15.131 11.1749 14.4736Z"/></svg></span>DeepSeek Harness Desktop</span>',
      '<span class="tb-actions">',
        '<button data-act="min" title="最小化">&#x2013;</button>',
        '<button data-act="max" title="最大化">&#x25A1;</button>',
        '<button data-act="close" class="tb-close" title="关闭">&#x2715;</button>',
      '</span>',
    ].join('')
    document.body.prepend(bar)
    const w = window.__DSH_WINDOW__
    window.__DSH_TITLEBAR_DEBUG__ = {
      injected: true,
      hasWindow: typeof w !== 'undefined',
      windowKeys: w ? Object.keys(w) : [],
    }
    if (w) {
      bar.querySelector('[data-act=min]').addEventListener('click', () => w.minimize())
      const maxBtn = bar.querySelector('[data-act=max]')
      maxBtn.addEventListener('click', () => w.toggleMaximize())
      bar.querySelector('[data-act=close]').addEventListener('click', () => w.close())
      const setMax = (m) => { maxBtn.textContent = m ? '\u2750' : '\u25A1' }
      setMax(false)
      w.isMaximized().then(setMax)
      w.onMaximized(setMax)
    }
  }
  run()
})();
`

/**
 * Immediate-feedback splash shown while the host boots. The window is created
 * BEFORE {@link spawnHost} resolves (that is what makes the desktop feel slow:
 * the old code only created the window after the whole host was ready), so this
 * page renders instantly and carries its own frameless drag region + window
 * controls through `window.__DSH_WINDOW__`. Loaded as a `data:` URL so no
 * extra build asset is needed. Themed with the same dark palette as the host
 * title bar injection for a seamless handoff.
 */
const SPLASH_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: #14171e; color: #d0d4dc;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; overflow: hidden;
  }
  #tb { height: 32px; display: flex; align-items: center; justify-content: space-between;
    background: #1b1f27; -webkit-app-region: drag; user-select: none; flex: 0 0 auto; }
  #tb .brand { padding-left: 12px; font-size: 12px; font-weight: 500; letter-spacing: .2px; display: flex; align-items: center; gap: 8px; }
  #tb .btns { display: flex; -webkit-app-region: no-drag; height: 100%; }
  #tb .btns button { width: 46px; height: 100%; border: 0; background: transparent; color: #d0d4dc;
    font-size: 12px; cursor: default; display: flex; align-items: center; justify-content: center; outline: none; }
  #tb .btns button:hover { background: rgba(255,255,255,.08); }
  #tb .btns .cl:hover { background: #e81123; color: #fff; }
  #body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
  .spin { width: 26px; height: 26px; border: 3px solid rgba(208,212,220,.18); border-top-color: #d0d4dc;
    border-radius: 50%; animation: r .9s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  .lbl { font-size: 14px; color: #aeb3bd; letter-spacing: .5px; }
</style>
</head>
<body>
<div id="tb">
  <span class="brand"><svg width="18" height="14" viewBox="0 0 23.16 17.04" fill="currentColor" aria-hidden="true"><path d="M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.3675C7.3748 12.3675 6.57878 12.889 6.57878 12.889C8.59534 14.4736 9.57286 14.995 9.97637 14.995C10.3799 14.995 11.1749 14.4736 11.1749 14.4736Z"/></svg>DeepSeek Harness Desktop</span>
  <span class="btns">
    <button data-a="min" title="最小化">&#x2013;</button>
    <button data-a="max" title="最大化">&#x25A1;</button>
    <button data-a="close" class="cl" title="关闭">&#x2715;</button>
  </span>
</div>
<div id="body">
  <span class="spin" role="status" aria-label="正在启动"></span>
  <span class="lbl">正在启动…</span>
</div>
<script>
  const w = window.__DSH_WINDOW__;
  if (w) {
    const maxBtn = document.querySelector('[data-a=max]');
    document.querySelector('[data-a=min]').addEventListener('click', () => w.minimize());
    maxBtn.addEventListener('click', () => w.toggleMaximize());
    document.querySelector('[data-a=close]').addEventListener('click', () => w.close());
    const setMax = (m) => { maxBtn.textContent = m ? '\u2750' : '\u25A1'; };
    setMax(false);
    w.isMaximized().then(setMax);
    w.onMaximized(setMax);
  }
</script>
</body>
</html>
`

/**
 * Recover after the host child exits post-boot: give a replacement (the
 * plugin manager's re-spawned host) up to 25s to claim our pinned port, then
 * reload the window against the same URL; if nobody claims it, spawn a
 * replacement host ourselves.
 */
async function recoverHost(): Promise<void> {
  if (recovering) return
  recovering = true
  try {
    // A host restart mints a NEW process token; the shell cannot read a
    // replacement host's URL line (it is not our child), so clear any
    // replacement on our pinned port and re-spawn to obtain a fresh
    // authenticated URL, then reload the window against it.
    killOrphanHosts()
    const newUrl = await spawnHost()
    await loadWindow(newUrl)
  } catch (error) {
    log(`host recovery failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    recovering = false
  }
}

/**
 * Kill any orphan `node` process that is running OUR host command line
 * (`bin.js --profile web --port <pinned>`). A plugin-manager self-restart
 * re-spawns the host detached, so it is not our `child`; without this cleanup
 * the next launch would collide with the leftover on the pinned port. The
 * pinned-port match deliberately excludes other dsh instances and other
 * profiles.
 */
function killOrphanHosts(): void {
  if (hostPort === 0) return
  try {
    const script = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'bin\\.js.*--profile.*web.*--port.*${hostPort}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 8000,
      windowsHide: true,
      stdio: 'ignore',
    })
    log('orphan host processes cleaned up')
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * App metadata for the settings "About" section. The shell is the only thing
 * that knows it is running as the desktop carrier, so version + runtime info
 * are resolved here and handed to the renderer over IPC.
 */
const APP_REPO_URL = 'https://github.com/wahu2008/DeepSeekHarnessDesktop'
const APP_BASIS = 'deepseek-harness dsh 0.1.1-rc.2'

function aboutInfo(): Record<string, string> {
  return {
    name: 'DeepSeek Harness Desktop',
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    basis: APP_BASIS,
    repoUrl: APP_REPO_URL,
    dshHome,
  }
}

/**
 * Compare dotted version strings, honouring prerelease suffixes.
 * `0.1.2 > 0.1.1-rc.2`; a release beats its own prerelease (`0.1.1 > 0.1.1-rc.2`);
 * equal-looking strings return 0. Unknown/empty inputs are never thrown on.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.replace(/^v/i, '').split(/[-.]/).map(p => Number.parseInt(p, 10) || 0)
  const A = parse(a)
  const B = parse(b)
  const len = Math.max(A.length, B.length)
  for (let i = 0; i < len; i += 1) {
    const x = A[i] ?? 0
    const y = B[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/**
 * Check the GitHub releases feed for a newer version and report it. The
 * renderer drives this on demand from the settings "Check for updates" button.
 * Returns a discriminated-status payload; network/HTTP errors degenerate to
 * `status: 'error'` so the UI can show a retryable warning instead of failing.
 */
async function checkForUpdates(): Promise<{
  status: 'current' | 'update' | 'none' | 'error'
  currentVersion?: string
  latestVersion?: string
  releaseUrl?: string
  name?: string
  publishDate?: string
  message?: string
}> {
  const current = app.getVersion()
  try {
    const res = await fetch('https://api.github.com/repos/wahu2008/DeepSeekHarnessDesktop/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404 || res.status === 403) {
      // No release published yet (or rate-limited) — not an error to block on.
      return { status: 'none', currentVersion: current }
    }
    if (!res.ok) {
      return { status: 'error', currentVersion: current, message: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string; name?: string; published_at?: string }
    const latest = (data.tag_name ?? '').replace(/^v/i, '')
    if (latest === '') {
      return { status: 'error', currentVersion: current, message: 'missing tag_name' }
    }
    const cmp = compareVersions(latest, current)
    return {
      status: cmp > 0 ? 'update' : 'current',
      currentVersion: current,
      latestVersion: latest,
      releaseUrl: data.html_url,
      name: data.name,
      publishDate: data.published_at,
    }
  } catch (error) {
    return { status: 'error', currentVersion: current, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Register window-control + app-bridge IPC. Called once after `mainWindow` exists. */
function registerWindowIpc(): void {
  // Window-control IPC for the injected title bar (and the splash) buttons.
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    if (mainWindow?.isMaximized() === true) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
  mainWindow?.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
  mainWindow?.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))
  // Settings "About" + "Check for updates" bridge. The renderer (host web UI)
  // reaches these through `window.__DSH_APP__` exposed by the preload.
  ipcMain.handle('app:about', () => aboutInfo())
  ipcMain.handle('app:check-update', () => checkForUpdates())
  ipcMain.handle('app:open-external', (_event, url: unknown) => {
    if (typeof url !== 'string') return false
    if (url.startsWith('https://') || url.startsWith('http://')) {
      return shell.openExternal(url)
    }
    return false
  })
}

/** Show the branded splash while the host boots. Never blocks the host spawn. */
async function loadSplash(): Promise<void> {
  if (mainWindow === undefined) return
  const splash = `data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`
  try {
    await mainWindow.loadURL(splash)
    log('splash loaded')
  } catch (error) {
    // The splash must never stall the boot; leave the window blank (preload
    // still exposes __DSH_WINDOW__) and let the host swap in on readiness.
    log(`splash load failed: ${error instanceof Error ? error.message : String(error)}`)
    await mainWindow.loadURL('about:blank').catch(() => {})
  }
}

async function main(): Promise<void> {
  await app.whenReady()
  // Staged boot timeline, written to dsh-desktop.log so a cold/warm comparison
  // pinpoints whether the host boot or the UI load dominates the open time.
  const t0 = Date.now()
  const milestone = (name: string): void => { log(`boot[${Date.now() - t0}ms] ${name}`) }
  milestone('app ready')

  logPath = join(app.getPath('userData'), 'dsh-desktop.log')
  log('=== dsh-desktop starting ===')

  // The host must use its own Harness home (default is ~/.dsh, shared with the
  // browser GUI's `dsh web`). Two hosts on the same profile fight over the
  // task-board ledger lock ("ledger is already owned by process N"), so the
  // desktop host gets an isolated home under the app's userData.
  dshHome = join(app.getPath('userData'), 'dsh-home')
  log(`dshHome=${dshHome}`)

  // Window FIRST — before the host boots. Creating it only after `spawnHost`
  // resolved (the old behaviour) left the user staring at nothing for the whole
  // host boot (~5s warm, 40s+ cold), which is exactly what made the desktop
  // feel slow. Register IPC after the window exists so its title bar works.
  mainWindow = new BrowserWindow({
    // Frameless: the shell injects its own title bar in the renderer so it
    // follows the Web UI theme/skin. We keep the window border and resize
    // affordances (frame:false; not titleBarStyle:overlay, so skin colors win).
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
    },
  })
  registerWindowIpc()
  milestone('window created')
  await loadSplash()
  milestone('splash shown')

  // Resolve the pinned port (fast: read the pin file or allocate a free port)
  // then spawn the host. The host boots while the splash stays up.
  await resolveHostPort()
  milestone('host port resolved')

  let url: string
  try {
    url = await spawnHost()
    log(`host ready at ${url} in ${Date.now() - t0}ms`)
    milestone('host ready')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`HOST FAILED: ${message}`)
    dialog.showErrorBox(
      'DeepSeek Harness Desktop',
      `Failed to start the host:\n${message}\n\nDetails logged to:\n${logPath}`,
    )
    app.quit()
    return
  }

  await loadWindow(url)
  milestone('UI loaded')
  log(`desktop ready end-to-end in ${Date.now() - t0}ms`)
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== undefined) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.on('before-quit', () => {
    quitting = true
    log('app quitting')
    child?.kill()
    child = undefined
    // Clean any detached replacement host immediately (synchronous), plus a
    // delayed sweep in case the killed child is still releasing the port.
    killOrphanHosts()
    setTimeout(killOrphanHosts, 1500)
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  void main()
}
