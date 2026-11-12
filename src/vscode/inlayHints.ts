import * as vscode from 'vscode';

export type HintProvider = (
  document: vscode.TextDocument,
  range: vscode.Range,
  token: vscode.CancellationToken,
) => Promise<vscode.InlayHint[]>;

/**
 * 只负责注册/刷新 inlay hint，具体解析和匹配交给 controller。
 */
export class InlayHintsProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.emitter.event;

  constructor(private readonly provider: HintProvider) {}

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.InlayHint[]> {
    return this.provider(document, range, token);
  }

  refresh(): void {
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
