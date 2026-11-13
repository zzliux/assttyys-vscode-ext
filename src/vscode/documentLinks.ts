import * as vscode from 'vscode';

export type DocumentLinkCallback = (
  document: vscode.TextDocument,
  token: vscode.CancellationToken,
) => Promise<vscode.DocumentLink[]>;

/**
 * Ctrl+单击跳转链接。VS Code 的 DocumentLink 天然是 Ctrl+单击。
 */
export class PreviewDocumentLinkProvider implements vscode.DocumentLinkProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeDocumentLinks = this.emitter.event;

  constructor(private readonly provider: DocumentLinkCallback) {}

  provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    return this.provider(document, token);
  }

  refresh(): void {
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
