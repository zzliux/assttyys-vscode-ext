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
