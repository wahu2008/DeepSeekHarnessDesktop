# DeepSeek Harness Desktop 自定义标题栏 + 主题联动 —— 最终方案

> 目标：去掉系统标题栏（那条 49px 白顶条），保留最小化/最大化/关闭窗口按钮与左上角标题，
> 并且**整个标题栏跟随 Web UI 皮肤/主题一起变化**（换肤即变色）。

## 核心思路

标题栏必须**画在渲染进程（网页 DOM）里**，而不是主进程静态画——这样它才能读到
Web UI 的主题 CSS 变量（`--dsw-alias-*`），换肤时随 `:root`/body 主题重绑自动变色。
主进程只负责：去边框 + 提供窗口控制 IPC + 拦截与标题栏同层的系统行为。

三条原则：
1. 标题栏颜色全部用 `var(--dsw-alias-*)`，皮肤一变它跟着变；
2. 窗口按钮（最小化/最大化/关闭）自绘 SVG，用 IPC 调主进程控制窗口，同样用主题变量着色；
3. 不改 dsh 主体源码——所有注入都在 `apps/desktop` 壳里收口（对 Web 用户零影响）。

## 分层改动

### ① 主进程 `apps/desktop/src/main.ts`

```ts
mainWindow = new BrowserWindow({
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  // 去掉系统标题栏，保留窗口边框/阴影/拖拽
  frame: false,
  titleBarStyle: 'hidden',
})

// 窗口控制 IPC（preload 暴露给渲染层）
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:toggle-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
// 最大化状态变化推给渲染层（切换 ▢/⧉ 图标）
mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))
```

### ② preload `apps/desktop/lib/preload.js`（已有 `__DSH_IPC__`，复用）

```js
contextBridge.exposeInMainWorld('__DSH_WINDOW__', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximized: (cb) => { /* ipcRenderer.on('window:maximized', ...) */ },
})
```

### ③ 渲染层注入标题栏（`apps/desktop` 壳，`did-finish-load` 后 `executeJavaScript`）

注入一段 `<div>` 标题栏 + `<style>`，全部引用主题变量：

```html
<style>
  .dsh-titlebar {
    position: fixed; top: 0; left: 0; right: 0; height: 40px;
    display: flex; align-items: center; justify-content: space-between;
    background: var(--dsw-alias-bg-module-platform);   /* 跟随皮肤 */
    color: var(--dsw-alias-label-primary);
    -webkit-app-region: drag;                          /* 整条可拖窗口 */
    z-index: 99999;
  }
  .dsh-titlebar .tb-title { padding-left: 12px; display:flex; align-items:center; gap:8px; }
  .dsh-titlebar .tb-actions { display:flex; -webkit-app-region: no-drag; }
  .dsh-titlebar .tb-actions button {
    width: 46px; height: 40px; border: 0; background: transparent;
    color: var(--dsw-alias-label-primary);
    cursor: default;
  }
  .dsh-titlebar .tb-actions button:hover { background: var(--dsw-alias-interactive-bg-hover); }
  .dsh-titlebar .tb-actions .tb-close:hover { background: #e81123; color:#fff; }
  /* 让页面内容整体下移，避开标题栏 */
  html body { padding-top: 40px; }
</style>
<div class="dsh-titlebar">
  <span class="tb-title">
    <FishLogo/>  DeepSeek Harness
  </span>
  <span class="tb-actions">
    <button data-act="min">▁</button>
    <button data-act="max">▢</button>
    <button data-act="close" class="tb-close">✕</button>
  </span>
</div>
<script>
  const win = window.__DSH_WINDOW__
  document.querySelector('[data-act=min]').onclick = () => win.minimize()
  document.querySelector('[data-act=max]').onclick = () => win.toggleMaximize()
  document.querySelector('[data-act=close]').onclick = () => win.close()
  win.onMaximized(v => { /* 切 ▢ / ⧉ */ })
</script>
```

**主题联动实现**：标题栏背景/文字/按钮/Hover 全部用 `var(--dsw-alias-*)`。
因为标题栏 DOM 与 Web UI 在同一个 `document` 下，皮肤插件重绑 `--dsw-alias-*`
时，标题栏**无需任何监听**，样式随 CSS 变量自动更新。
品牌 logo 用 `--dsw-alias-brand-primary-*`（DeepSeek 深蓝），换肤时 logo 色也跟随。

### ④ 界面元素归位
- 左上角：窗口标题（DeepSeek Harness + logo，可拖拽）
- 右上角：最小化▁ / 最大化▢ / 关闭✕（自绘，主题色）
- Web UI 原有的侧边栏 logo/title（ui-sidebar.logoRow）**保持原样**，不受影响

## 效果对照

| 现在 | 改后 |
|---|---|
| 顶部一条灰色系统标题栏（不变肤） | 一条自定义标题栏，跟随当前皮肤颜色 |
| 系统默认标题 | 左上角 logo + "DeepSeek Harness"（可拖窗口） |
| 右上角系统窗口按钮（不随肤） | 自绘三按钮（随肤），hover 高亮用主题变量 |
| 换肤只改应用内容区 | 整窗（含标题栏）一起换肤 |

## 命名与文件
- 主进程：`apps/desktop/src/main.ts`（frame/titleBarStyle + IPC）
- preload：`apps/desktop/lib/preload.js`
- 注入：`apps/desktop/src/main.ts` 里 `did-finish-load` 回调注入 DOM/CSS/JS（收口在壳）
- 皮肤变量：`--dsw-alias-*`（`packages/client/ui-theme/src/design-platform.css` 定义，皮肤插件重绑）

## 注意事项
1. `frame: false` 会丢 Windows 11 贴靠/动画（方案 B 的取舍）；若想保留贴靠，用
   `titleBarStyle:'hidden' + titleBarOverlay: { color: <主题色> }`，但那样按钮色是主进程静态的，
   **换肤时按钮色不随动**（除非额外 IPC 调 `setTitleBarOverlay`）。本方案选无边框自绘，换取"换肤全联动"。
2. 拖动窗口：`-webkit-app-region: drag`，按钮区 `no-drag`。
3. 最大化/还原图标切换：监听 `window:maximized` 事件。

---

请确认：**要用无边框自绘（换肤全联动，但丢 Windows 11 贴靠）**，
还是**保留系统贴靠、按钮用 WCO 静态颜色（换肤只变标题栏背景，按钮色固定）**？
确认后我直接实施（改源码 + 同步已装壳 + 重启验证）。
