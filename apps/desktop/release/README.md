# DeepSeek Harness Desktop — 0.1.1-rc.2 (社区定制版)

> 基于官方 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) `0.1.1-rc.2` 构建的
> Windows 桌面定制版。在此次定制中修复了多个已知问题并优化了窗口体验。

## 版本
- **版本号**：`0.1.1-rc.2`
- **基础**：官方 `deepseek-harness` 的 `dsh 0.1.1-rc.2`（领先 rc.7 743 个提交）
- **平台**：Windows (x64)

## 两种交付形态

| 形态 | 文件 | 说明 |
|---|---|---|
| **安装版** | `DeepSeek Harness Desktop Setup 0.1.1-rc.2.exe` | NSIS 安装器，一键安装，创建桌面/开始菜单快捷方式 |
| **便携版** | `win-unpacked/` 目录 | 免安装，解压即用，直接运行 `DeepSeek Harness Desktop.exe` |

> 两个版本的**功能完全一致**，只是交付方式不同。安装版会注册系统图标与快捷方式，
> 便携版适合放到任意目录/U盘，不写入注册表。

## 本定制版相比官方 rc.7 的新增/修复

### 窗口体验
1. **无边框自定义标题栏**：去掉系统默认标题栏，改用 Web UI 主题色渲染的标题栏（跟随皮肤/主题自动变色）。
   - 左上角：DeepSeek 鲸鱼 logo + "DeepSeek Harness Desktop"
   - 右上角：最小化 / 最大化 / 关闭 三个窗口按钮（自绘，随主题色）
   - 标题栏整条可拖拽移动窗口
2. **应用图标改为 DeepSeek 鲸鱼**：任务栏、窗口标题、安装后桌面快捷方式、开始菜单，全部使用鲸鱼图标（不再用 Electron 默认图标）。
3. **不再弹出系统浏览器**：启动桌面版时只打开桌面窗口，不会同时弹出系统默认浏览器（修复"双开"问题）。

### 稳定性修复
4. **`__DSH_WINDOW__` 窗口控制 API 修复**：修正 preload 脚本模块格式（CJS），使窗口按钮真正可用。
5. **内容区不再挤压/滚动**：修复标题栏挤压内容的问题，默认页（含设置入口）直接显示在窗口内，无需滚动。

### 插件生态（host/浏览器侧）
6. **装插件免重启**：`watchProfileBundles` 让宿主热插新 bundle 的插件层，装完插件无需重启。
7. **新插件 UI 免刷新**：`reconcileGraph` 让浏览器自动加载新插件的界面，无需手动刷新页面。

### 第三方插件兼容
8. **modlens 视觉桥兼容**：为 `@liustack/modlens` 的合成适配器补齐 `prepareCall` 方法，修复
   使用 `(modlens vision)` 模型时的 `registration.adapter.prepareCall is not a function` 报错。

---

## 安装版使用说明

1. 运行 `DeepSeek Harness Desktop Setup 0.1.1-rc.2.exe`
2. 选择安装目录（默认 `C:\Program Files\DeepSeek Harness Desktop`），点击安装
3. 安装完成后自动创建桌面与开始菜单快捷方式（鲸鱼图标）
4. 首次启动自动拉起宿主并显示窗口

> 安装包未签名（构建配置 `signExecutable: false`），Windows SmartScreen 可能提示
> "未知发布者"，点击"更多信息 → 仍要运行"即可。

## 便携版使用说明

1. 解压 `win-unpacked/` 到任意目录（建议非 C 盘或 U 盘）
2. 运行目录内的 `DeepSeek Harness Desktop.exe`
3. 免安装、免注册表，删除目录即完全卸载

---

## 常见问题

- **启动时是否会自动打开浏览器？** 不会。本定制已加 `--no-open`，只显示桌面窗口。
- **换肤色时标题栏会变色吗？** 会。标题栏颜色绑定 Web UI 主题变量，切换皮肤/主题自动跟随。
- **装插件需要重启吗？** 大部分不需要（热插），个别 bundle 层插件按其机制处理。
- **首次运行提示未知发布者？** 是未签名构建的 Windows 安全提示，放行即可。

---

## 本地打包

若需从源码重新打包（Windows）：

```powershell
# 在仓库根执行
npm run build                        # 构建 lib + 前端 dist
cd apps/desktop
npx electron-builder --win nsis      # 生成安装版 + 便携版
```

详细打包流程见 `apps/desktop/PACKAGING-PROMPT.md`。
