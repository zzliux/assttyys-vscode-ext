const assert = require('node:assert');
const path = require('node:path');
const vscode = require('vscode');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('Assttyys 真实截图匹配', () => {
  let api;
  let root;

  suiteSetup(async function () {
    this.timeout(120000);
    const extension = vscode.extensions.getExtension('zzliux.assttyys-vscode-ext');
    assert.ok(extension);
    api = await extension.activate();
    root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    await delay(500);
  });

  test('multiDetectColors 对真实截图产生图标', async function () {
    this.timeout(120000);
    const file = path.join(root, 'src', 'common', 'multiDetectColors.ts');
    const document = await vscode.workspace.openTextDocument(file);
    const range = new vscode.Range(0, 0, document.lineCount - 1, 0);
    const token = new vscode.CancellationTokenSource().token;
    const started = Date.now();
    const hints = await api.controller.provideHints(document, range, token);
    const elapsed = Date.now() - started;
    console.log(`real hints=${hints.length} elapsed=${elapsed}ms`);
    console.log(`indexed screenshots=${api.controller.screenshots.entries.length}`);
    assert.ok(hints.length >= 10, `真实截图命中数偏少：${hints.length}`);
    assert.ok(elapsed < 30000, `真实截图匹配耗时过长：${elapsed}ms`);
  });

  test('功能文件字符串引用对真实截图产生图标', async function () {
    this.timeout(120000);
    const file = path.join(root, 'src', 'common', 'funcList', '001_准备.ts');
    const document = await vscode.workspace.openTextDocument(file);
    const range = new vscode.Range(0, 0, document.lineCount - 1, 0);
    const token = new vscode.CancellationTokenSource().token;
    const started = Date.now();
    const hints = await api.controller.provideHints(document, range, token);
    const elapsed = Date.now() - started;
    console.log(`prepare hints=${hints.length} elapsed=${elapsed}ms`);
    assert.ok(hints.length >= 1, '准备界面相关的字符串引用应该命中真实截图');
    assert.ok(elapsed < 30000, `功能文件匹配耗时过长：${elapsed}ms`);
  });

  test('功能文件提供 Ctrl+单击跳转链接', async () => {
    const file = path.join(root, 'src', 'common', 'funcList', '004_接受邀请.ts');
    const document = await vscode.workspace.openTextDocument(file);
    const token = new vscode.CancellationTokenSource().token;
    const links = await api.controller.provideDocumentLinks(document, token);
    assert.ok(links.length >= 2);
    assert.ok(links.some((link) => link.target.fragment.includes('L')));
    assert.ok(links.some((link) => link.tooltip.includes('multiFindColors')));

    const backupFile = path.join(
      root,
      'src',
      'common',
      'funcList.bak',
      '010_地图进入突破界面.ts',
    );
    const backupDocument = await vscode.workspace.openTextDocument(backupFile);
    const backupLinks = await api.controller.provideDocumentLinks(backupDocument, token);
    assert.ok(backupLinks.some((link) => link.tooltip.includes('operator[0]')));
    assert.ok(backupLinks.some((link) => link.tooltip.includes('multiDetectColors')));

    // 验证 DocumentLink 的 #L行,列 fragment 能真正定位到目标位置。
    const targetLink = links.find((link) => link.tooltip.includes('multiFindColors'));
    assert.ok(targetLink);
    const match = /L(\d+),(\d+)/.exec(targetLink.target.fragment);
    assert.ok(match);
    await vscode.commands.executeCommand('vscode.open', targetLink.target);
    await delay(500);
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor);
    assert.strictEqual(editor.selection.active.line + 1, Number(match[1]));
    assert.ok(editor.document.lineAt(editor.selection.active.line).text.includes('组队探索_宝箱'));
  });

  test('动态 desc: thisOperator[0].desc 也生成截图图标', async function () {
    this.timeout(120000);
    const file = path.join(
      root,
      'src',
      'common',
      'funcList.bak',
      '010_地图进入突破界面.ts',
    );
    const document = await vscode.workspace.openTextDocument(file);
    const range = new vscode.Range(0, 0, document.lineCount - 1, 0);
    const token = new vscode.CancellationTokenSource().token;
    const hints = await api.controller.provideHints(document, range, token);
    const dynamicHint = hints.find((hint) =>
      String(hint.tooltip?.value ?? '').includes('thisOperator[0].desc'),
    );
    assert.ok(dynamicHint, '动态 desc 没有生成图标');

    const links = await api.controller.provideDocumentLinks(document, token);
    for (const hint of hints) {
      const overlapping = links.find(
        (link) =>
          hint.position.isAfter(link.range.start) && hint.position.isBefore(link.range.end),
      );
      assert.ok(!overlapping, '预览图标和跳转链接的点击区域重叠了');
    }
  });

  test('功能文件 findMultiColor 字符串也显示匹配图标', async function () {
    this.timeout(120000);
    const file = path.join(root, 'src', 'common', 'funcList', '312_通用活动.ts');
    const document = await vscode.workspace.openTextDocument(file);
    const range = new vscode.Range(0, 0, document.lineCount - 1, 0);
    const token = new vscode.CancellationTokenSource().token;
    const hints = await api.controller.provideHints(document, range, token);
    const findHint = hints.find((hint) =>
      String(hint.tooltip?.value ?? '').includes('find:体力图标'),
    );
    assert.ok(findHint, 'findMultiColor 的字符串没有生成图标');
  });

  test('找色文件可见区域可以命中真实截图', async function () {
    this.timeout(120000);
    const file = path.join(root, 'src', 'common', 'multiFindColors.ts');
    const document = await vscode.workspace.openTextDocument(file);
    // 剧情问号附近，真实截图里有对应场景。
    const range = new vscode.Range(3055, 0, Math.min(document.lineCount - 1, 3115), 0);
    const token = new vscode.CancellationTokenSource().token;
    const started = Date.now();
    const hints = await api.controller.provideHints(document, range, token);
    const elapsed = Date.now() - started;
    console.log(`find hints=${hints.length} elapsed=${elapsed}ms`);
    assert.ok(hints.length >= 1, '剧情问号附近的找色定义应该命中真实截图');
    assert.ok(elapsed < 30000, `找色匹配耗时过长：${elapsed}ms`);
  });
});
