# DSH Desktop — Windows x64 安装包

本仓库**只发布 `DSH Desktop` 的 Windows x64 安装包（exe）及其更新元数据**，不包含源代码。

## 当前版本

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.5-rc.2`（预发布 / pre-release） |
| 安装包 | `deepseek-harness-0.1.5-rc.2-win-x64.exe` |
| 大小 | 171.7 MiB（180,062,425 字节） |
| SHA-256 | `C7724080D12F72315AD3C7A5BB749DD6866A7AE6182799B6C87BEBC44793C766` |
| 平台 | Windows 10 1809+ / Windows 11，x64 |
| 安装方式 | NSIS 每用户安装（不需要管理员权限，默认装入 `%LOCALAPPDATA%`） |
| 应用图标 | 鲸鱼图标（已嵌入 exe 与安装器） |
| 更新源 | 本仓库 Releases（`provider: github`、`owner: wahu2008`、`repo: DeepSeekHarnessDesktop`、预发布通道） |

## 下载与安装

1. 打开 [Releases](https://github.com/wahu2008/DeepSeekHarnessDesktop/releases)，下载 `deepseek-harness-0.1.5-rc.2-win-x64.exe`。
2. 双击运行安装包，按向导完成安装（每用户安装，不写系统目录，不需要管理员）。
3. 安装后从开始菜单或桌面快捷方式启动；窗口使用自绘标题栏（右上角为最小化、最大化/还原、关闭）。

卸载：`设置 → 应用 → 已安装的应用 → DSH Desktop → 卸载`。

## 自动更新

安装包内置的更新检查（`设置 → 关于 → 检查更新`）读取本仓库 Releases 中的 `latest.yml`。
因此每个版本发布时，必须在同一次 Release 中上传以下**三个资产**，缺一不可：

- `deepseek-harness-<版本>-win-x64.exe`
- `deepseek-harness-<版本>-win-x64.exe.blockmap`
- `latest.yml`

并勾选 **Set as a pre-release**（`0.1.5-rc.2` 属于预发布版本），不要勾选 draft；
发布后 `https://github.com/wahu2008/DeepSeekHarnessDesktop/releases/tag/v0.1.5-rc.2` 即为本版本的下载与更新地址。

## 校验下载

```powershell
Get-FileHash .\deepseek-harness-0.1.5-rc.2-win-x64.exe -Algorithm SHA256
```

输出的哈希应与上表 `SHA-256` 一致。

## English

`deepseek-harness-0.1.5-rc.2-win-x64.exe` is the DSH Desktop installer for Windows x64 (version `0.1.5-rc.2`, pre-release). Download it from this repository's Releases page. Every release must also carry `…-win-x64.exe.blockmap` and `latest.yml` in the same release, because the in-app updater (`Settings → About → Check for updates`) resolves those GitHub release assets; mark the release as a pre-release. Verify the download against the SHA-256 listed above. This repository publishes the installer only — no source code.
