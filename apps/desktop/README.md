# dsh-desktop (Electron shell)

English | [中文](README.zh.md)

DeepSeek Harness desktop shell: an Electron window that spawns a system Node running the `dsh web` host and loads its UI.

## Startup behavior (window-first)

The old order was "wait for the host to be fully ready, then create the window" — the `dsh web` host's Loader tree settling usually takes seconds (40s+ cold), during which no window appears at all. That was the main reason the app felt slow to open.

It is now **window-first**: `app.whenReady()` creates the window immediately and loads an inline startup page (brand + "Starting…") while the host boots in the background; once the host prints its `dsh web:` URL it swaps in the real UI. The window and its control buttons are usable from the first instant, and the user always sees feedback while the host starts.

The startup page is a `data:` URL inline HTML (no extra bundled asset); title-bar controls work through `__DSH_WINDOW__` (preload).

## Startup timing (diagnostics)

The main process writes a boot timeline to `dsh-desktop.log` for cold/warm comparison and bottleneck location (host boot vs UI load):

```
boot[0ms] app ready
boot[<n>ms] window created
boot[<n>ms] splash shown
boot[<n>ms] host port resolved
boot[<n>ms] host ready
boot[<n>ms] UI loaded
desktop ready end-to-end in <n>ms
```

> Reference numbers (fork `dsh web --port 0`, fresh temp `DSH_HOME`): cold start (first run, cold file cache) ≈ 44s; a subsequent warm start ≈ 5.3s. That time is mostly the host Loader tree settling; the shell's window-first optimization turns "invisible until ready" into "a window is there from the start".

## Why the host cannot run inside the Electron main process

DSH's vendored Loader resolves bare plugin packages via `node-addon-require-builtin` →
`node-addon-native-custom-loader`, a native addon compiled for the **Node ABI** that accesses
Node's internal ESM loader. Under Electron's Node ABI the addon is unavailable: `ModuleLoader.fromInternal()`
returns undefined and bare-package resolution falls back to a failing `import()`. The host therefore must run
under **system Node** (a child process), and cannot be embedded in the Electron main process.

Plan B's native IPC carrier (`IpcApiClient` + `mountIpcHost` + `createIpcConnectionRpc`,
plus the `client-modules`/`client-connection` decoupling, the `desktop-app` bundle, and the `desktop` profile)
**is fully landed and passes 142 unit tests**; once the Loader-under-Electron restriction is lifted it can switch
to an embedded host.

## Run (dev)

```sh
pnpm install
pnpm run build                 # build lib + frontend dist
pnpm --filter @deepseek-ai/dsh-desktop run build   # compile shell src → lib
pnpm --filter @deepseek-ai/dsh-desktop start       # electron . launch
```

The shell spawns `node <apps/cli>/lib/bin.js --profile web --port 0`, parses the URL line on stdout, and loads the window.

## Package (installable)

The electron-builder config lives in `electron-builder.yml`; outputs are `release/win-unpacked/` (portable) and
the NSIS installer `release/DeepSeek Harness Desktop Setup <version>.exe`.

**Key point**: the `dsh` host needs its full dependency closure (including peer deps and the native binaries in
optionalDependencies, e.g. `@img/sharp-win32-x64`, `node-addon-require-builtin-win32-x64-msvc`). pnpm's default
node_modules are symlinks and `pnpm deploy` drops peer deps, so this repo flattens the closure itself:

```sh
# 0. Ensure a full build (lib + frontend dist)
pnpm run build

# 1. Flatten the runtime dependency closure (BFS over deps/peer/optional, resolved per parent package)
node apps/desktop/scripts/flatten.mjs
#    -> apps/desktop/staging/dsh-flat/node_modules/<name>/  (528 real packages)

# 2. Reassemble into the layout the shell expects: dsh/lib/bin.js + dsh/node_modules/
node apps/desktop/scripts/stage.mjs
#    -> apps/desktop/staging/dsh/{lib,config,package.json,node_modules/}

# 3. Place the system Node runtime + the unpacked Electron distribution (electronDist avoids
#    Windows' transient EPERM write-lock on the freshly written 225MB exe)
Copy-Item "$(node -e "process.stdout.write(process.execPath)")" apps/desktop/staging/node/node.exe
$zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache\*\electron-v43.4.0-win32-x64.zip" | Sort-Object LastWriteTime | Select-Object -Last 1
Expand-Archive $zip.FullName apps/desktop/staging/electron-dist -Force

# 4. Package
cd apps/desktop
npx electron-builder --win nsis
```

`electron-builder.yml`'s `extraResources` uses `from: staging` + `filter: ["dsh/**/*", "node/**/*"]`, so `node_modules`
sits under `dsh/` — electron-builder only hard-codes the exclusion of the **root-level** node_modules
(`filter.js`'s `relative === "node_modules"`), and sub-level ones are unaffected. Also `asar: false` +
`signAndEditExecutable: false` avoid the resource-edit/sign write-lock on the freshly copied 225MB exe.

In the packaged environment the shell locates `dsh/` and `node/` via `process.resourcesPath` and spawns
`resources/node/node.exe resources/dsh/lib/bin.js --profile web --port 0`.

## Troubleshooting stale plugin incompatibility after an upgrade (common boot failure)

After upgrading the desktop shell to a new version (e.g. moving to the alpha.2 baseline), **the host may exit at
startup because of a stale third-party plugin** — this is not a problem with the new installer, but a stale plugin
left in the user data directory that is incompatible with the new baseline's upstream API.

Typical symptom: the app shows a "Failed to start the host" dialog or exits right after launch, and `dsh-desktop.log`
contains an error like:

```
Error: failed to import loader entry dsh-market (dshmarket):
  The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'
    at ...\dsh-home\profiles\web\node_modules\dshmarket\lib\settings.js:35
```

Meaning: some old plugin (in the example the market `dshmarket`) imports an export that has been removed in the new
version (`installSettingsSection`), so the host fails to parse and exits.

### Locate

1. The log is at `%APPDATA%\@deepseek-ai\dsh-desktop\dsh-desktop.log`; look at the last startup block's `HOST FAILED` / `stderr` stack.
2. The `...\dsh-home\profiles\<profile>\node_modules\<plugin>` in the error is the stale plugin causing the incompatibility.

### Fix

In priority order:

- **Update that plugin to the newest version compatible with the new baseline.** Many third-party plugins only
  support old baselines; authors ship fixes for compatibility. Example: `dshmarket` v1.29.2 is incompatible with
  alpha.2, and the official v1.38.1+ fixed it (no longer stops dsh 0.1.2-alpha from booting). Change the plugin's
  dependency range in `%APPDATA%\@deepseek-ai\dsh-desktop\dsh-home\profiles\web\package.json` to a compatible
  range, then run `pnpm install --no-frozen-lockfile` in the profile dir.
- If the plugin is no longer needed, **uninstall/remove it**: delete its `dependencies` entry in the profile, its
  `dsh.profile.bundles` entry, plus `...\profiles\<profile>\node_modules\<plugin>` and the insert in `cordis.patch.yml`.
- To fully return to a clean state, **reset that profile's plugin layer**: delete `...\dsh-home\profiles\<profile>`
  (this drops the other plugins installed in that profile); the next launch rebuilds it from the new-version template.
  Sessions, settings, storage, and attachments live in other `dsh-home` subdirectories (`sessions`, `storages`,
  `llm-deepseek`, `attachments`, etc.) and are unaffected.

> Tip: if it still fails after one update, other stale plugins are also incompatible — locate and update or remove each
> by the log. Third-party plugin adaptation to upstream APIs is the plugin author's responsibility; the new-version
> host need not change for old plugins.