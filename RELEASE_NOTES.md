# v0.3.1 — 修复预览图标与跳转点击区域冲突

发布日期：2026-11-13

## 修复

- 修复 `desc: 'key'` 和 `desc: thisOperator[N].desc` 位置上的 📷 预览图标与 Ctrl+单击跳转链接点击区域重叠的问题。
- 字符串/动态 desc 的 📷 图标移到该行行尾，彻底避开跳转链接的文本区域。
- 字符串引用的跳转范围只包含引号内的内容，不再给引号和图标前的空白加下划线。
- 图标前不再额外加空格。
- 现在点击 📷 图标只执行截图预览，不会再同时跳到本文件 `operator[N]` 或 `multiDetectColors.ts`。
- 点击文字区域仍然执行 Ctrl+单击跳转：
  - `thisOperator[N]` / `.desc` / `.oper[...]` → 本文件对应 `operator[N]` 字段；
  - `desc: 'key'` → `multiDetectColors.ts` 对应 **key 行**；
  - `findMultiColor('key')` → `multiFindColors.ts` 对应 **key 行**。

## 0.3.0 已有功能

- `desc: thisOperator[N].desc` 动态引用显示截图图标，并复用目标 desc 缓存。
- 支持 `funcList.bak`。
- 项目级比色预匹配和匹配缓存继续保留。

## 验证

- 22 个核心单元测试通过；
- 5 个演示集成测试通过；
- 5 个真实截图测试通过；
- 集成测试额外断言所有预览图标位置都不落在跳转链接范围内。

## 安装

1. 打开 [Releases 页面](https://github.com/zzliux/assttyys-vscode-ext/releases/tag/0.3.1)。
2. 下载 `assttyys-vscode-ext-0.3.1.vsix`。
3. VS Code 扩展面板 → `...` → “从 VSIX 安装...”。
4. 重新加载窗口。

或命令行：

```powershell
code --install-extension .\assttyys-vscode-ext-0.3.1.vsix --force
```
