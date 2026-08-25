# DeepSeek Harness Desktop — 安装版 (0.1.1-rc.2)

**文件**：`DeepSeek Harness Desktop Setup 0.1.1-rc.2.exe`
**大小**：约 162 MB　**平台**：Windows x64　**安装类型**：NSIS 安装器

## 安装

1. 双击运行 `DeepSeek Harness Desktop Setup 0.1.1-rc.2.exe`
2. 选择安装目录（默认 `C:\Program Files\DeepSeek Harness Desktop`），可自定义
3. 点击"安装"，等待进度完成
4. 完成后会自动在**桌面**和**开始菜单**创建快捷方式（DeepSeek 鲸鱼图标）
5. 启动 `DeepSeek Harness Desktop` 即可使用

## 本版本特性

- **无边框自定义标题栏**：DeepSeek 鲸鱼 logo + 窗口标题，右上角自绘最小化/最大化/关闭按钮，整条可拖拽，**随皮肤/主题自动变色**
- **鲸鱼应用图标**：任务栏、窗口、桌面快捷方式、开始菜单全部使用 DeepSeek 鲸鱼图标
- **不弹系统浏览器**：启动只打开桌面窗口（已加 `--no-open`）
- **窗口控制正常**：最小化/最大化/关闭按钮可用（修复 preload 模块格式）
- **内容区无滚动条**：默认页（含设置）直接可见
- **装插件免重启**、**新插件 UI 免刷新**
- **modlens 视觉兼容**：修复 `(modlens vision)` 模型的报错

## 卸载

通过 Windows「设置 → 应用 → 已安装的应用」卸载，或运行安装器选择卸载。
卸载会移除快捷方式；用户数据保存在 `%APPDATA%\@deepseek-ai\dsh-desktop`（卸载默认保留）。

## 关于签名

本构建未做代码签名（`signExecutable: false`）。首次运行时 Windows SmartScreen
可能提示"未知发布者"——属预期，点击「更多信息 → 仍要运行」即可正常使用。

## 已知说明

- 安装器为 NSIS 打包，`oneClick: false`，支持自定义安装目录。
- 用户数据（会话、设置、插件）独立存放在 `%APPDATA%\@deepseek-ai\dsh-desktop\dsh-home`，
  升级/重装不会丢失。
