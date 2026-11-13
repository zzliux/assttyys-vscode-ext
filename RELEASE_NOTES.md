# v0.4.0 — findMultiColor 图标与状态栏细分

发布日期：2026-11-13

## 新增

### findMultiColor 字符串图标

功能文件里的：

```ts
thisScript.findMultiColor('key')
thisScript.findMultiColorEx('key')
thisScript.findMultiColorLoop('key')
```

第一个字符串参数现在也会显示 📷 匹配图标：

- 命中后在行尾显示图标；
- 复用 `multiFindColors.ts` 对应 key 的匹配缓存；
- 未命中或 key 找不到时不显示。

### 状态栏细分

- `后台项目比色 N 个 desc`
- `找色 N 个 desc`
- `找色 N 个 · 比色 M 个 desc`
- 匹配过程中显示 `图 done/total`
- 缓存命中时短暂显示 `缓存命中 · 截图 N`
- tooltip 显示最近一次匹配结果

## 后台全量找色预匹配

启动 10 秒后，空闲时自动：

- 用**图优先**方式匹配全部 234 个 find pattern；
- 修复之前按 key 去重只缓存 140 个分组的问题，同一 key 下的多个 desc 分组现在都会预匹配；
- 每张图只解码一次、只建一次 R 索引；
- 同时测试所有 find pattern，而不是按 pattern 分组反复解码；
- 结果写入 find 缓存，功能文件引用的 key 后续直接命中；
- 每 32 个 pattern / 每张图 yield 一次，避免长时间卡住界面；
- 状态栏显示 `后台找色 全部 234 个 desc · 图 done/total`；
- 打开/保存 find 定义不会中断后台全量，连续滚动最多避让 5 轮后仍会启动；
- 重启后首次扫描会先比对磁盘缓存指纹，截图没变时直接复用，不再误报“截图集合有变化”；
- 连续点击不同 desc 打开预览时，标签和面板内标题都会更新。

实测全部 234 个 find pattern × 200 张 1280×720 截图约 **27 秒**（带 yield，后台执行）。

## 未改动

- `findColorScanLimit` 仍默认 200；
- 找色前台仍只匹配当前文件/当前可见区域；
- 200 张限制是否继续扩大，等观察 CPU/缓存命中后再决定。

## 验证

- 23 个核心单元测试通过；
- 6 个真实截图测试通过，包含 findMultiColor 字符串图标。

## 安装

```powershell
code --install-extension .\assttyys-vscode-ext-0.4.0.vsix --force
```

或从 Release 页面下载 `assttyys-vscode-ext-0.4.0.vsix` 后安装。
