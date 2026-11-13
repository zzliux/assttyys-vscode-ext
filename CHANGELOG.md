# Changelog

## 0.3.0

- 新增 Ctrl+单击跳转：
  - `thisOperator[N]`、`thisOperator[N].desc`、`.oper[...]` 跳到本文件对应的 `operator[N]`；
  - operator 项里的 `desc: 'key'` 跳到 `multiDetectColors.ts` 定义；
  - `findMultiColor('key')` 等调用跳到 `multiFindColors.ts` 定义。
- `desc: thisOperator[N].desc` 动态引用也生成截图匹配图标，并复用目标 desc 的缓存。
- 支持 `funcList.bak` 目录下的文件。

## 0.2.0

- 项目级比色预匹配：启动/截图集变化时一次匹配 workspace 内所有比色 desc（`multiDetectColors.ts` + `funcList` 内联数组），打开任意功能文件直接查缓存，不再按文件重复解码截图。
- 预匹配加入截图 generation 校验，匹配过程中截图集变化不会写入错误缓存。
- 实测 1324 个比色 desc 首次约 3.5 秒，之后打开文件约 0.12 秒。

## 0.1.1

- 匹配缓存：文档状态、desc 签名、截图指纹、磁盘缓存；截图集/参数不变时不重复匹配。
- 比色文件一次预匹配全部 `desc`，滚动不重复解码截图。
- 新增截图索引变化检测和磁盘缓存单元测试（共 18 个核心测试）。

## 0.1.0

- 解析 `multiDetectColors.ts`、`multiFindColors.ts` 和 `funcList` 功能文件中的 `desc` 定义。
- 按配置目录/glob 扫描截图，只匹配同分辨率图片。
- 在命中的 `desc` 数组/字符串引用旁显示可点击的 📷 inlay hint。
- 截图预览面板：多图切换、匹配点叠加、复制路径、资源管理器定位、打开原图。
- 截图目录/定义文件变化自动刷新，状态栏显示索引数量。
- 17 个核心单元测试 + 5 个演示用 VS Code 扩展宿主端到端测试 + 3 个真实截图测试。
