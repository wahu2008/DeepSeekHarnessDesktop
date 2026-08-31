# DeepSeek Harness Desktop 打包提示词（可整体粘贴执行）

把下面整段复制给任意 AI agent 或按序手动执行即可。自包含：无需额外上下文。

---

## 任务

在仓库 `F:\GITPLACE\deepseek-harness`（Windows）把 DeepSeek Harness Desktop 打包成：
- `apps/desktop/release/win-unpacked/`（便携版）
- `apps/desktop/release/DeepSeek Harness Desktop Setup 0.1.0-rc.7.exe`（NSIS 安装器）

打包后的应用：Electron 壳 spawn `resources/node/node.exe resources/dsh/lib/bin.js --profile web --port 0` 启动宿主。

## 前置检查

1. `node --version`（需 ≥22.19，预期 v24.x）、`pnpm --version`。
2. 确认 `pnpm-workspace.yaml` 的 `allowBuilds` 含 `electron-winstaller: true`（不能是占位文本 `set this to true or false`，否则 `npm run build` 会因 `[ERR_PNPM_IGNORED_BUILDS]` 退出码 1 失败）。缺则补上再继续。
3. 确认 electron 缓存存在：`Get-ChildItem "$env:LOCALAPPDATA\electron\Cache\*\electron-v43.4.0-win32-x64.zip"`。缺则先 `pnpm install`。

## 打包步骤（按序执行，任一步非零退出即停下排查）

### 步骤 0：完整构建 lib + 前端

```powershell
cd F:\GITPLACE\deepseek-harness
npm run build
```

注意：此步**不会**编译 `apps/desktop/src/main.ts`（壳），壳在第 4 步单独编译。

### 步骤 1：展平运行时依赖闭包

```powershell
node apps/desktop/scripts/flatten.mjs
```

预期输出 `FLATTEN DONE, packages = 528 copied = 528`。末尾的 `UNRESOLVED (optional/other-platform, safe to ignore)`（darwin/linux 原生包、bufferutil、utf-8-validate 等）属正常，忽略。

### 步骤 2：重组为壳期望布局

```powershell
node apps/desktop/scripts/stage.mjs
```

预期输出 `STAGE DONE`，生成 `apps/desktop/staging/dsh/{lib,config,package.json,node_modules/}`。

### 步骤 3：放置 Node 运行时与 Electron 发行版

```powershell
Copy-Item "$(node -e "process.stdout.write(process.execPath)")" apps/desktop/staging/node/node.exe
$zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache\*\electron-v43.4.0-win32-x64.zip" | Sort-Object LastWriteTime | Select-Object -Last 1
Expand-Archive $zip.FullName apps/desktop/staging/electron-dist -Force
```

若 `apps/desktop/staging/electron-dist\electron.exe` 已存在且 `version` 文件 = 43.4.0，可跳过重解压（直接用现有解压产物）。

### 步骤 4：编译 Electron 壳（易漏！必须单独做）

```powershell
cd F:\GITPLACE\deepseek-harness\apps\desktop
npm run build
```

electron-builder 打的是 `apps/desktop/lib/` 编译产物；只改 `src/main.ts` 不跑这步会打出旧壳。编译后验证：

```powershell
Select-String -Path apps/desktop/lib/main.js -Pattern "pinned host port|recoverHost|orphan host"
```

三条模式都应有匹配；为空说明壳没编译进新代码。

### 步骤 5：打包

```powershell
cd F:\GITPLACE\deepseek-harness\apps\desktop
npx electron-builder --win nsis
```

预期结尾 `building target=nsis ...`、`BUILDER EXIT: 0`。产物在 `apps/desktop/release/`。

## 打包后验证（必做，防止旧产物混入）

```powershell
$release = "F:\GITPLACE\deepseek-harness\apps\desktop\release"
# ① 壳：固定端口 + 自动重连 + 清孤儿宿主
Select-String -Path "$release\win-unpacked\resources\app\lib\main.js" -Pattern "pinned host port|recoverHost|resolveHostPort"
# ② host：热插 bundle（监听 dsh.profile.bundles）
Select-String -Path "$release\win-unpacked\resources\dsh\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js" -Pattern "watchProfileBundles"
# ③ 浏览器免刷新：graph 广播 + reconcileGraph
$hmr = "$release\win-unpacked\resources\dsh\node_modules\@deepseek-ai\dsh-client-hmr\lib"
Select-String -Path "$hmr\index.js" -Pattern "onGraphChanged"
Select-String -Path "$hmr\client.js" -Pattern "reconcileGraph"
```

①②③ 都必须有输出；任一为空 = 旧产物混入，回到对应步骤重打。

## 已知坑（碰到时对照）

- **`npm run build` exit 1 + `[ERR_PNPM_IGNORED_BUILDS]`** → `pnpm-workspace.yaml` 的 `allowBuilds.electron-winstaller` 不是 `true`。修后重跑。
- **安装包里 main.js 旧** → 漏跑步骤 4。补编译后重跑步骤 5。
- **flatten 一堆 UNRESOLVED** → 正常（其他平台/可选包），忽略。
- **SmartScreen 提示未知发布者** → 安装包未签名（`signAndEditExecutable: false` 为仓库默认），点"更多信息 → 仍要运行"。

## 完成标准

`apps/desktop/release/DeepSeek Harness Desktop Setup 0.1.0-rc.7.exe` 存在、时间戳为本次打包时刻，且上述 ① ② ③ 三项验证全部命中。
