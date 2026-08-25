# dsh-desktop (Electron shell)

DeepSeek Harness 桌面壳：一个 Electron 窗口，spawn 系统 Node 运行 `dsh web` 宿主并加载其 UI。

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
pnpm run build                 # 构建 lib + 前端 dist
pnpm --filter @deepseek-ai/dsh-desktop run build   # 编译壳 src → lib
pnpm --filter @deepseek-ai/dsh-desktop start       # electron . 启动
```

壳 spawn `node <apps/cli>/lib/bin.js --profile web --port 0`，解析 stdout 的 URL 行并加载窗口。

## 打包（installable）

electron-builder 配置在 `electron-builder.yml`，产物 `release/win-unpacked/`（便携版）与
NSIS 安装器 `release/DeepSeek Harness Desktop Setup <version>.exe`。

**关键点**：`dsh` 宿主需要其完整依赖闭包（含 peer deps + optionalDependencies 里的原生二进制，
如 `@img/sharp-win32-x64`、`node-addon-require-builtin-win32-x64-msvc`）。pnpm 默认的
node_modules 是符号链接，`pnpm deploy` 又丢 peer deps，因此用仓库内脚本自己展平：

```sh
# 0. 确保已完整构建（lib + 前端 dist）
pnpm run build

# 1. 展平运行时依赖闭包（BFS over deps/peer/optional，按父包逐包解析）
node apps/desktop/scripts/flatten.mjs
#    -> apps/desktop/staging/dsh-flat/node_modules/<name>/  (528 个真实文件包)

# 2. 重组为壳期望的布局：dsh/lib/bin.js + dsh/node_modules/
node apps/desktop/scripts/stage.mjs
#    -> apps/desktop/staging/dsh/{lib,config,package.json,node_modules/}

# 3. 放置系统 Node 运行时 + 已解压的 Electron 发行版（electronDist 用于规避
#    Windows 上 electron-builder 对刚写入 225MB exe 的瞬时写锁 EPERM）
Copy-Item "$(node -e "process.stdout.write(process.execPath)")" apps/desktop/staging/node/node.exe
$zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache\*\electron-v43.4.0-win32-x64.zip" | Sort-Object LastWriteTime | Select-Object -Last 1
Expand-Archive $zip.FullName apps/desktop/staging/electron-dist -Force

# 4. 打包
cd apps/desktop
npx electron-builder --win nsis
```

`electron-builder.yml` 的 `extraResources` 用 `from: staging` + `filter: ["dsh/**/*", "node/**/*"]`，
让 `node_modules` 位于 `dsh/` 子级——electron-builder 只硬编码排除**根级** node_modules
（`filter.js` 的 `relative === "node_modules"`），子级不受影响。同时 `asar: false` +
`signAndEditExecutable: false` 规避对刚拷贝 225MB exe 的资源编辑/签名写锁。

壳在打包环境下用 `process.resourcesPath` 定位 `dsh/` 与 `node/`，spawn
`resources/node/node.exe resources/dsh/lib/bin.js --profile web --port 0`。
