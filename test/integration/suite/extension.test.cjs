const assert = require('node:assert');
const path = require('node:path');
const vscode = require('vscode');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('Assttyys 截图匹配扩展', () => {
  let api;
  let root;

  suiteSetup(async function () {
    if (process.env.REAL_TEST === '1') this.skip();
    this.timeout(60000);
    const extension = vscode.extensions.getExtension('zzliux.assttyys-vscode-ext');
    assert.ok(extension, '没有找到 zzliux.assttyys-vscode-ext 扩展');
    api = await extension.activate();
    root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    await delay(500);
  });

  test('启动后索引到两张截图像', () => {
    assert.strictEqual(api.controller.screenshots.entries.length, 2);
    assert.strictEqual(api.controller.screenshots.candidates(1280, 720).length, 2);
  });

  test('功能文件同时为内联数组和字符串引用生成可点击图标', async () => {
    const file = path.join(root, 'src', 'common', 'funcList', '999_测试.ts');
    const document = await vscode.workspace.openTextDocument(file);
    const range = new vscode.Range(0, 0, document.lineCount - 1, 0);
    const token = new vscode.CancellationTokenSource().token;
    const hints = await api.controller.provideHints(document, range, token);

    assert.strictEqual(hints.length, 2, '应有一个内联 desc 和一个字符串引用');
    for (const hint of hints) {
      assert.ok(Array.isArray(hint.label));
      assert.ok(hint.label[0].value.includes('📷'));
      assert.strictEqual(hint.label[0].command.command, 'assttyys.previewMatch');
      assert.strictEqual(hint.label[0].command.arguments.length, 2);
    }
  });

  test('比色定义文件只为匹配成功的 desc 生成图标', async () => {
    const file = path.join(root, 'src', 'common', 'multiDetectColors.ts');
    const document = await vscode.workspace.openTextDocument(file);
    const range = new vscode.Range(0, 0, document.lineCount - 1, 0);
    const token = new vscode.CancellationTokenSource().token;
    const hints = await api.controller.provideHints(document, range, token);

    assert.strictEqual(hints.length, 1, '未匹配界面不应该有图标');
    assert.ok(hints[0].label[0].value.includes('2'), '两张截图都应命中');
    assert.ok(hints[0].label[0].value.includes('📷'));
  });

  test('找色定义文件可以命中截图', async () => {
    const file = path.join(root, 'src', 'common', 'multiFindColors.ts');
    const document = await vscode.workspace.openTextDocument(file);
    const range = new vscode.Range(0, 0, document.lineCount - 1, 0);
    const token = new vscode.CancellationTokenSource().token;
    const hints = await api.controller.provideHints(document, range, token);

    assert.strictEqual(hints.length, 1);
  });

  test('连续点击不同图标时预览标签会更新', async function () {
    this.timeout(30000);
    const file = path.join(root, 'src', 'common', 'funcList', '999_测试.ts');
    const document = await vscode.workspace.openTextDocument(file);
    const range = new vscode.Range(0, 0, document.lineCount - 1, 0);
    const token = new vscode.CancellationTokenSource().token;
    const hints = await api.controller.provideHints(document, range, token);
    assert.ok(hints.length >= 2);

    const labels = [];
    for (const hint of hints.slice(0, 2)) {
      const command = hint.label[0].command;
      await vscode.commands.executeCommand(command.command, ...command.arguments);
      await delay(600);
      const tab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((item) => item.label.includes('截图预览'));
      assert.ok(tab, '预览面板没有打开');
      labels.push(tab.label);
    }
    assert.notStrictEqual(labels[0], labels[1], '切换预览后标签没有更新');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('点击图标的命令可以打开预览面板', async function () {
    this.timeout(30000);
    const file = path.join(root, 'src', 'common', 'multiDetectColors.ts');
    const document = await vscode.workspace.openTextDocument(file);
    const range = new vscode.Range(0, 0, document.lineCount - 1, 0);
    const token = new vscode.CancellationTokenSource().token;
    const hints = await api.controller.provideHints(document, range, token);
    const command = hints[0].label[0].command;
    await vscode.commands.executeCommand(command.command, ...command.arguments);
    await delay(1200);

    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    assert.ok(tabs.some((tab) => tab.label.includes('截图预览')), '预览面板没有打开');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});
