> 本项目由 DeepSeek Harness 模型 DeepSeek V4.1-Flash 完成。

# Assttyys 截图匹配

为 [assttyys_autojs](https://github.com/zzliux/assttyys_autojs) 的比色/找色定义匹配本地截图，并在 `desc` 数组旁显示一个可点击的 📷 图标。点击图标会打开截图预览，可切换同一 `desc` 命中的多张截图、叠加显示匹配点、复制截图完整路径。

## 功能

- 自动识别以下文件：
  - `src/common/funcList/**/*.ts`：功能文件里的内联 `desc` 数组；
  - `src/common/multiDetectColors.ts`：多点比色定义；
  - `src/common/multiFindColors.ts`：多点找色定义。
- 按配置的截图目录/文件/glob 扫描截图，只使用与定义**分辨率完全相同**的图片。
- 功能文件里的 `desc: '准备界面_未准备'` 字符串引用，会根据同项目的 `multiDetectColors.ts` 解析，并在字符串旁显示图标。
- 支持 Ctrl+单击跳转：
  - `thisOperator[N]` / `thisOperator[N].desc` / `.oper[...]` → 本文件对应的 `operator[N]` 字段；
  - `desc: 'key'` → `multiDetectColors.ts` 对应定义；
  - `findMultiColor('key')` 等 → `multiFindColors.ts` 对应定义。
- `desc: thisOperator[N].desc` 这种动态引用也会显示截图匹配图标，并复用 `operator[N]` 对应 desc 的缓存。
- 图标显示命中数量，例如 `📷 3`；点击后可在预览面板中左右切换。
- 预览面板支持：
  - 上一张/下一张、下拉选择；
  - 叠加显示匹配点（橙色为锚点/第一个点，绿色为其余点）；
  - 复制路径、在资源管理器中显示、打开原图；
  - 左右方向键切换。
- 截图目录变化、定义文件保存后自动刷新（可关闭自动刷新）。
- 状态栏显示当前索引到的截图数量，点击可手动刷新。

> 图标使用 VS Code 原生的 Inlay Hint 实现，因此可以真正点击。如果看不到图标，请确认设置 `editor.inlayHints.enabled` 不是 `off`（默认是 `onUnlessPressed`，按住 `Ctrl`/`Cmd` 时会临时隐藏）。

## 安装

> 每个版本的变更和实测数据见 [RELEASE_NOTES.md](RELEASE_NOTES.md)。

### 方式一：从 Release 安装（推荐给日常使用）

1. 打开项目的 [Releases 页面](https://github.com/zzliux/assttyys-vscode-ext/releases/latest)。
2. 在最新 tag 的 Release 附件中下载 VSIX，文件名类似：

   ```text
   assttyys-vscode-ext-0.3.1.vsix
   ```

3. 在 VS Code 中打开扩展面板，点右上角 `...` → “从 VSIX 安装...”，选择刚下载的 `.vsix`。
   或者命令行（把路径换成实际下载位置）：

   ```powershell
   code --install-extension .\assttyys-vscode-ext-0.3.1.vsix --force
   ```

4. 重新加载 VS Code 窗口。

### 方式二：开发模式（F5）

1. 用 VS Code 打开本项目 `assttyys-vscode-ext`。
2. 执行 `npm install`。
3. 按 `F5`，会打开一个“扩展开发宿主”窗口。
4. 在开发宿主中打开 `assttyys_autojs` 仓库目录，再打开功能/比色/找色文件即可看到图标。

> 调试扩展时，开发宿主使用的是本项目的 `dist/extension.js`；修改源码后执行 `npm run build`，或运行 `npm run watch` 让 esbuild 持续构建，然后在开发宿主中执行“开发人员: 重新加载窗口”。

## 配置

在 VS Code 设置中搜索 `assttyys`，或直接编辑 `.vscode/settings.json`：

```json
{
  "assttyys.screenshotPaths": [
    "D:/screenshots",
    "D:/another-shots/**/*.png",
    "${workspaceFolder}/screenshots"
  ],
  "assttyys.colorSimilarity": 93,
  "assttyys.findColorSimilarity": 97,
  "assttyys.findColorOffset": true,
  "assttyys.maxMatchesPerPattern": 20,
  "assttyys.findColorScanLimit": 200,
  "assttyys.showStringReferences": true,
  "assttyys.autoRefresh": true
}
```

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `assttyys.screenshotPaths` | `[]` | 可配置多个目录、图片文件或 glob。相对路径按工作区解析。支持 `${workspaceFolder}`、`${env:NAME}`。 |
| `assttyys.includeSubfolders` | `true` | 目录是否递归扫描。 |
| `assttyys.previewImageExtensions` | `["png","jpg","jpeg"]` | 参与匹配的扩展名；当前只支持 PNG/JPEG 解码。 |
| `assttyys.colorSimilarity` | `93` | 多点比色相似度，对应脚本里的 `colorSimilar`。 |
| `assttyys.findColorSimilarity` | `97` | 多点找色相似度，对应 `multiColorSimilar`；定义里写了 `similar` 时优先用定义值。 |
| `assttyys.findColorOffset` | `true` | 找色是否使用 3×3 错位匹配，和脚本运行时 `FindMultiColor(..., true)` 一致。 |
| `assttyys.maxMatchesPerPattern` | `20` | 每个 `desc` 最多保留多少张命中截图（按修改时间从新到旧）。 |
| `assttyys.findColorScanLimit` | `200` | 找色定义只扫描最近的 N 张同分辨率截图；比色定义始终扫描全部。 |
| `assttyys.showStringReferences` | `true` | 是否在 `desc: 'key'` 字符串旁也显示图标。 |
| `assttyys.autoRefresh` | `true` | 打开/保存定义文件或截图变化时自动重新匹配。 |

## 匹配规则

### 多点比色

对应 `multiDetectColors.ts` 和功能文件里的内联 `desc` 数组：

```ts
desc: [1280, 720, [
  [left, 100, 100, 0x112233],
  [center, 640, 360, 0x445566],
]]
```

- 只使用宽高完全等于 `1280×720` 的截图；
- 每个点在截图上的固定坐标检查 RGB；
- **默认是相似度匹配，不是全等**：`colorSimilarity=93` 转成每个通道允许差 18（`roundHalfEven(255 - 255 × 0.93) = 18`），即 `abs(截图通道 - 定义通道) <= 18`；
- 只有把 `colorSimilarity` 设为 `100` 时，容差才是 0，也就是 RGB 全等；
- 所有点都满足才算命中；
- 点的第 5 个参数为 `1` 时按“取反”处理（该点不匹配才算成功），和 ScriptLib 的 `CompareColorEx` 一致。

### 多点找色

对应 `multiFindColors.ts`：

```ts
'结界_进攻': {
  region: [center, 1280, 720, 304, 317, 1166, 713],
  desc: [[1280, 720, [
    [center, 325, 362, 0x9a3434],
    [center, 444, 363, 0x933e2d],
  ]]],
}
```

- 第一个点是锚点，其余点是相对锚点的偏移；
- 在 `region` 内搜索锚点；
- 默认开启 3×3 错位匹配，和脚本运行时一致；
- 使用定义里的 `similar`，没有则使用 `findColorSimilarity`。

### 字符串引用

```ts
{
  desc: '准备界面_未准备',
  oper: [...]
}
```

会按当前功能文件向上查找同项目的 `multiDetectColors.ts`；找到对应 key 后，用该比色定义参与截图匹配，图标显示在字符串右引号后。

## 手动测试步骤

1. 准备一张与定义分辨率相同的截图（例如 1280×720），放进任意目录。
2. 在设置里把该目录加入 `assttyys.screenshotPaths`。
3. 打开 `src/common/multiDetectColors.ts`。
4. 如果截图确实对得上某个定义，对应的 `desc` 数组右括号后会显示 `📷`。
5. 点击图标，预览面板应打开；如果有多个命中，用“上一张/下一张”切换。
6. 点击“复制路径”，剪贴板应得到当前截图的完整路径。
7. 打开功能文件（如 `001_准备.ts`），字符串引用旁和内联数组旁都应显示图标。
8. 打开 `multiFindColors.ts`，对得上的找色定义应显示图标；找色比对比色慢，首次打开可能需要等一两秒。

也可以用命令面板执行：

- `Assttyys: 刷新截图与匹配`
- `Assttyys: 预览光标处的匹配截图`
- `Assttyys: 显示解析统计`
- `Assttyys: 显示日志`

## 开发与测试

先克隆两个参考项目（单元测试会直接读取它们的真实定义文件）：

```powershell
git clone https://github.com/zzliux/assttyys_autojs.git .refs/assttyys_autojs
git clone https://github.com/zzliux/color-helper.git .refs/color-helper
```

然后：

```powershell
npm install
npm run typecheck
npm test                 # 核心解析/匹配/截图索引单元测试
npm run test:integration # 启动真实 VS Code 扩展宿主跑端到端测试
npm run build            # 生成 dist/extension.js
npm run package          # 生成 VSIX
```

本项目还提供了 `.vscode/launch.json`，按 `F5` 会先执行 `npm: build`，再打开 `.refs/assttyys_autojs` 作为扩展开发宿主工作区。也可以选择“运行扩展（手动选择工作区）”，再打开任意 `assttyys_autojs` 目录。

> 颜色匹配的坐标换算、容差和错位匹配行为参考了 `color-helper` 中由 ScriptLib 改造的 `GraphicHelper` / `AnchorGraphicHelper`。

集成测试会用本机 VS Code（或下载测试版）打开 `test-output/integration-workspace`，自动生成 1280×720 截图，验证：

- 截图索引；
- 功能文件内联 `desc` + 字符串引用的图标；
- 比色定义只对命中的 `desc` 显示图标；
- 找色定义命中；
- 点击图标命令能打开预览面板。

如果本机 VS Code 不在默认路径，设置环境变量：

```powershell
$env:VSCODE_EXE = 'D:\path\to\Code.exe'
npm run test:integration
```

从 GitHub 拉代码失败时，可为 git 配置代理：

```powershell
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
```

## 性能与缓存

- 同一分辨率的截图在一次匹配中只解码一次，再用这张图同时测试当前文件里的所有比色 `desc`；后续滚动不会重复解码。
- VSIX 内置了 Windows x64 的 [sharp](https://sharp.pixelplumbing.com/) 原生解码器。
- 实测数据（三个真实截图目录，共 1162 张，其中 986 张 1280×720）：
  - 首次启动/截图变化：项目内 1324 个比色 desc 一次预匹配约 **3.5 秒**；
  - 之后打开 `multiDetectColors.ts` 约 **0.12 秒**；
  - 之后打开 `001_准备.ts` 约 **0.12 秒**；
  - `multiFindColors.ts` 的“剧情问号”可见区域：首次约 **1.8 秒**（找色不做全项目预匹配）。
- 如果原生 sharp 在当前平台无法加载，会自动退回纯 JS 的 pngjs/jpeg-js；功能不变，但速度会慢一些（同等数据约 30 秒）。

### 缓存策略

- **文档状态缓存**：文件内容没变时不重新解析/匹配。
- **desc 签名缓存**：只比较 `kind`、分辨率、点坐标/颜色/容差、`region`、`similar`。只改注释、排版、描述文字时复用旧匹配结果。
- **截图指纹缓存**：根据截图路径、修改时间、大小、分辨率生成指纹；截图集合没变就不重新匹配。
- **磁盘缓存**：匹配结果写入 VS Code 的扩展 `globalStorage`，重启 VS Code 后仍可复用；截图集合或匹配参数变化时自动失效。
- **项目级比色预匹配**：启动/截图集变化时，把 workspace 内 `multiDetectColors.ts` 和 `funcList` 的全部比色 `desc` 一次性做图优先匹配；之后打开任何功能文件都直接查缓存，不再按文件重新解码。
- **找色**：仍需逐像素搜索，默认只匹配最近 200 张同分辨率截图（`assttyys.findColorScanLimit`），并按 `desc` 签名缓存结果。

## 已知限制

- 只匹配同分辨率截图，不做缩放；定义里是 1280×720 就只使用 1280×720 的截图。
- 只解析 TypeScript 字面量形式的 `desc` 数组/字符串；运行时动态拼接（如 `'准备界面_' + desc`）不会生成图标。
- 当前只解码 PNG/JPEG；BMP/WebP 需要额外解码器。
- 字符串引用依赖 `multiDetectColors.ts` 文件名和 `src/common/funcList` 目录结构；如果项目结构不同，需要调整 `src/core/extract.ts` 的识别规则。
- 找色在 `region` 内逐像素搜索，首次打开大文件时可能有一两秒延迟；结果会按截图和配置缓存。

## 项目结构

```
src/
  core/
    model.ts            类型定义
    extract.ts          TypeScript AST 解析 desc/region/similar
    detectIndex.ts      multiDetectColors key 索引
    screenshotIndex.ts  截图扫描、尺寸读取、分辨率分组
    imageLoader.ts      sharp / PNG / JPEG 解码
    redIndex.ts         按 R 通道分桶的找色索引
    color.ts            颜色/坐标/相似度工具
    matcher.ts          比色/找色单图匹配
    matcherService.ts   匹配调度与缓存
  vscode/
    controller.ts       插件主控制器
    inlayHints.ts       desc 旁图标
    previewPanel.ts     截图预览 Webview
    config.ts           设置读取
  extension.ts          激活入口
```

## License

MIT。VSIX 内置的 sharp/libvips 及其依赖的第三方许可见 `THIRD-PARTY-NOTICES.md`。
