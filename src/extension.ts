import * as vscode from 'vscode';
import { ExtensionController } from './vscode/controller';

let controller: ExtensionController | undefined;

export interface AssttyysExtensionApi {
  controller: ExtensionController;
}

export async function activate(context: vscode.ExtensionContext): Promise<AssttyysExtensionApi> {
  controller = new ExtensionController(context);

  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('assttyys.refresh', async () => {
      await controller?.refreshScreenshotsAndMatches('手动刷新');
    }),
    vscode.commands.registerCommand('assttyys.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'assttyys');
    }),
    vscode.commands.registerCommand('assttyys.previewMatch', async (uri: string, stateKey: string) => {
      await controller?.previewMatch(uri, stateKey);
    }),
    vscode.commands.registerCommand('assttyys.previewAtCursor', async () => {
      await controller?.previewAtCursor();
    }),
    vscode.commands.registerCommand('assttyys.showOutput', () => {
      controller?.showOutput();
    }),
    vscode.commands.registerCommand('assttyys.showStats', async () => {
      await controller?.showStats();
    }),
  );

  await controller.initialize();
  return { controller };
}

export function deactivate(): void {
  controller = undefined;
}
