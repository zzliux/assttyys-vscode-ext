# v0.2.0 — 项目级比色预匹配

发布日期：2026-11-13

## 这个版本解决了什么

之前打开一个新的功能文件时，插件只会预匹配该文件里的 `desc`。换一个文件就是一批新的 `desc`，需要重新解码截图，所以即使已经做过缓存，切换文件仍可能等几秒。

v0.2.0 改为**项目级预匹配**：启动或截图集合变化时，一次匹配 workspace 内所有比色 `desc`，之后打开任何功能文件都直接查缓存。

## 主要变化

- 项目级比色预匹配：
  - 扫描 `src/common/multiDetectColors.ts`；
  - 扫描 `src/common/funcList/**/*.ts` 里的内联 `desc`；
  - 一次做图优先匹配，结果按 `desc` 签名缓存。
- 匹配缓存继续使用：
  - 文档状态缓存；
  - `desc` 签名缓存（坐标/颜色/容差/region/similar 不变即可复用）；
  - 截图指纹缓存；
  - 磁盘缓存（VS Code 重启后仍可用）。
- 预匹配会校验截图 generation，匹配途中截图集合变化不会写入错误缓存。
- 找色 `desc` 仍然只匹配当前可见区域，不参与全项目预匹配。

## 实测数据

环境：Windows，VS Code，三个真实截图目录，共 1162 张截图，其中 986 张 1280×720。

| 项目 | 结果 |
| --- | --- |
| 项目比色 `desc` | 1324 个 |
| 首次预匹配 | 约 3.5 秒 |
| 之后打开 `multiDetectColors.ts` | 约 0.12 秒 |
| 之后打开 `001_准备.ts` | 约 0.12 秒 |
| `multiFindColors.ts` 可见区域 | 约 1.8 秒 |

冷启动的 3.5 秒仍然会解码约 986 张截图，CPU 会高一次；预匹配完成后基本只查缓存。

## 安装

1. 打开 [Releases 页面](https://github.com/zzliux/assttyys-vscode-ext/releases/tag/0.2.0)。
2. 下载附件 `assttyys-vscode-ext-0.2.0.vsix`。
3. VS Code 扩展面板 → `...` → “从 VSIX 安装...”，选择下载的文件。
4. 重新加载 VS Code 窗口。

或命令行：

```powershell
code --install-extension .\assttyys-vscode-ext-0.2.0.vsix --force
```

## 配置提醒

- `assttyys.screenshotPaths` 推荐直接配置目录，例如 `C:/Users/zzliux/Downloads`，默认会递归子目录。
- 如果路径是从别处复制的，注意不要带不可见 Unicode 字符（例如 `U+202A`），否则会扫描不到截图。
- 找色默认只扫描最近 200 张同分辨率截图，可用 `assttyys.findColorScanLimit` 调整。

## 已知限制

- 只匹配同分辨率截图，不做缩放。
- 找色不做全项目预匹配，首次进入新区域仍需搜索。
- 原生 sharp 解码器目前打包的是 Windows x64；其他平台会退回纯 JS 解码，功能可用但速度较慢。
