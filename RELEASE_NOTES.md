# v0.3.0 — Ctrl+单击跳转与动态 desc 匹配

发布日期：2026-11-13

## 主要变化

### Ctrl+单击跳转

在 `funcList` / `funcList.bak` 的功能文件里支持：

- `thisOperator[N]` → 本文件 `operator[N]` 的 `desc` 字段；
- `thisOperator[N].desc` / `thisOperator[N].oper[...]` → 本文件对应 `operator[N]` 的 `desc` / `oper` 字段；
- `desc: 'key'` → `multiDetectColors.ts` 的对应 **key 行**；
- `findMultiColor('key')` / `findMultiColorEx` / `findMultiColorLoop` → `multiFindColors.ts` 的对应 **key 行**。

跳转链接使用 VS Code 原生 DocumentLink，按住 Ctrl 时显示可点击样式，点击后定位到目标行。

### 动态 desc 匹配

`desc: thisOperator[N].desc` 现在也会显示截图匹配图标。

图标复用 `operator[N]` 对应 desc 的缓存匹配结果，不会为这个动态引用单独重新匹配。

### 支持 funcList.bak

`src/common/funcList.bak/**/*.ts` 里的文件也会参与图标和跳转解析。

## 验证

- 22 个核心单元测试通过；
- 5 个演示集成测试通过；
- 5 个真实截图测试通过；
- 已实际验证跳转落在 `multiDetectColors.ts` / `multiFindColors.ts` 的 key 行。

## 安装

1. 打开 [Releases 页面](https://github.com/zzliux/assttyys-vscode-ext/releases/tag/0.3.0)。
2. 下载 `assttyys-vscode-ext-0.3.0.vsix`。
3. VS Code 扩展面板 → `...` → “从 VSIX 安装...”。
4. 重新加载窗口。

或命令行：

```powershell
code --install-extension .\assttyys-vscode-ext-0.3.0.vsix --force
```

## 配置提醒

- `assttyys.screenshotPaths` 推荐直接配置目录，会自动递归子目录。
- 路径里不要带不可见 Unicode 字符（如 `U+202A`），否则扫描不到截图。
- 找色默认只扫描最近 200 张同分辨率截图，可用 `assttyys.findColorScanLimit` 调整。
