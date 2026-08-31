# dsh-desktop (Electron 桌面壳)

[English](README.md) | 中文

DeepSeek Harness 桌面壳：一个 Electron 窗口，spawn 系统 Node 运行 `dsh web` 宿主并加载其 UI。

## 启动行为（窗口先行）

旧的启动顺序是“先等宿主完全就绪，再创建窗口”——宿主 `dsh web` 的 Loader 树结算通常要几秒（冷启动甚至 40s+），期间窗口完全不出现，这正是“打开慢”的主因。

现改为**窗口先行**：`app.whenReady()` 后立即创建窗口并加载一个内联启动页（品牌 + “正在启动…”），宿主在后台并行启动；宿主打印 `dsh web:` URL 后切载真实 UI。这样窗口与窗口控制按钮在启动瞬间即可用，宿主启动期间用户始终看到反馈。

启动页是 `data:` URL 内联 HTML（无需额外打包资源），标题栏控件通过 `__DSH_WINDOW__`（preload）工作。

## 启动计时（诊断）

主进程会把启动时间线写入 `dsh-desktop.log`，便于冷/热对比定位瓶颈（宿主启动 vs UI 加载）：

```
boot[0ms] app ready
boot[<n>ms] window created
boot[<n>ms] splash shown
boot[<n>ms] host port resolved
boot[<n>ms] host ready
boot[<n>ms] UI loaded
desktop ready end-to-end in <n>ms
```

> 量化参考（fork `dsh web --port 0`，全新临时 `DSH_HOME`）：冷启动（首次、冷文件缓存）≈ 44s；随后的热启动 ≈ 5.3s。该时间主要是宿主 Loader 树结算，壳层的窗口先行优化把它从“打开前不可见”变为“打开即有窗口”。

## 为什么宿主不能在 Electron 主进程内运行

DSH 的 vendored Loader 解析裸插件包依赖 `node-addon-require-builtin` →
`node-addon-native-custom-loader`，这是为 **Node ABI** 编译的原生扩展，用于访问
Node 内部 ESM loader。在 Electron 的 Node ABI 下该扩展不可用，`ModuleLoader.fromInternal()`
返回 undefined，裸包解析回退到 `import()` 失败。因此宿主必须运行在**系统 Node**（子进程），
不能内嵌 Electron 主进程。

方案 B 的原生 IPC 载体（`IpcApiClient` + `mountIpcHost` + `createIpcConnectionRpc`，
以及 `client-modules`/`client-connection` 的解耦、`desktop-app` bundle、`desktop` profile）
**已全部落库并通过 142 项单元测试**；待 Loader-under-Electron 限制解除后可切换为内嵌宿主。

## 运行（dev）

```sh
pnpm install
pnpm run build                 # build lib + frontend dist
pnpm --filter @deepseek-ai/dsh-desktop run build   # compile shell src → lib
pnpm --filter @deepseek-ai/dsh-desktop start       # electron . launch
```

壳 spawn `node <apps/cli>/lib/bin.js --profile web --port 0`，解析 stdout 的 URL 行并加载窗口。

## 打包（installable）

electron-builder 配置在 `electron-builder.yml`，产物 `release/win-unpacked/`（便携版）与
NSIS 安装器 `release/DeepSeek Harness Desktop Setup <version>.exe`。

**关键点**：`dsh` 宿主需要其完整依赖闭包（含 peer deps + optionalDependencies 里的原生二进制，
如 `@img/sharp-win32-x64`、`node-addon-require-builtin-win32-x64-msvc`）。pnpm 默认的
node_modules 是符号链接，`pnpm deploy` 又丢 peer deps，因此用仓库内脚本自己展平：

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

`electron-builder.yml` 的 `extraResources` 用 `from: staging` + `filter: ["dsh/**/*", "node/**/*"]`，
让 `node_modules` 位于 `dsh/` 子级——electron-builder 只硬编码排除**根级** node_modules
（`filter.js` 的 `relative === "node_modules"`），子级不受影响。同时 `asar: false` +
`signAndEditExecutable: false` 规避对刚拷贝 225MB exe 的资源编辑/签名写锁。

壳在打包环境下用 `process.resourcesPath` 定位 `dsh/` 与 `node/`，spawn
`resources/node/node.exe resources/dsh/lib/bin.js --profile web --port 0`。

## 升级后旧插件不兼容的排查（常见启动失败）

把桌面壳升级到新版本（例如换到 alpha.2 基线）后，**宿主可能在启动时因旧第三方插件而退出**——这不是新安装包的问题，而是用户数据目录里残留的旧插件与新版本上游 API 不兼容。

典型症状：应用窗口弹「Failed to start the host」或一启动就退出，`dsh-desktop.log` 里出现类似下面的错误：

```
Error: failed to import loader entry dsh-market (dshmarket):
  The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'
    at ...\dsh-home\profiles\web\node_modules\dshmarket\lib\settings.js:35
```

含义：某个旧插件（例子里是插件市场 `dshmarket`）`import` 了一个在新版本里已被删除的导出（`installSettingsSection`），导致宿主解析失败、退出。

### 定位

1. 日志在 `%APPDATA%\@deepseek-ai\dsh-desktop\dsh-desktop.log`，看最后一次启动段的 `HOST FAILED` / `stderr` 栈。
2. 报错里的 `...\dsh-home\profiles\<profile>\node_modules\<插件>` 就是造成不兼容的旧插件。

### 解决办法

按优先级：

- **更新该插件到兼容新版的最新版**。很多第三方插件老版本只兼容旧基线，作者会为兼容新版本发布修复版。例：`dshmarket` v1.29.2 不兼容 alpha.2，官方发布的 v1.38.1+ 已修复（不再 stop dsh 0.1.2-alpha 启动）。把 `%APPDATA%\@deepseek-ai\dsh-desktop\dsh-home\profiles\web\package.json` 里该插件依赖版本改到兼容区间，然后在 profile 目录执行 `pnpm install --no-frozen-lockfile`。
- 若该插件不再需要，**卸载/移除它**：删掉它在 profile 里 `dependencies` 的声明、`dsh.profile.bundles` 里的条目、以及 `...\profiles\<profile>\node_modules\<插件>` 与 `cordis.patch.yml` 里的插入项。
- 想完全回到干净状态，可**重置该 profile 的插件层**：删除 `...\dsh-home\profiles\<profile>`（会丢该 profile 里另装的插件），下次启动会按新版本模板重建。会话、设置、存储、附件等数据位于 `dsh-home` 其它子目录（`sessions`、`storages`、`llm-deepseek`、`attachments` 等），不受影响。

> 提示：如果一次更新后仍报错，说明还有其它旧插件不兼容——按日志逐一定位、逐次更新或移除即可。第三方插件对上游 API 的适配由其作者负责，新版宿主无需为旧插件改动。
