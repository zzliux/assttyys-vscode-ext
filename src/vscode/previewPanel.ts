import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MatchSet, ScreenshotMatch } from '../core/model';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function mimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

interface PreviewPayload {
  type: 'render';
  index: number;
  total: number;
  label: string;
  fileName: string;
  filePath: string;
  imageSrc: string;
  width: number;
  height: number;
  points: Array<{ x: number; y: number }>;
  anchor: { x: number; y: number };
  showPoints: boolean;
  files: string[];
}

/**
 * 截图预览面板。全局只保留一个，重复点击会复用并切换内容。
 */
export class PreviewPanel implements vscode.Disposable {
  private static current: PreviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private matchSet: MatchSet;
  private index: number;
  private showPoints = true;
  private disposed = false;

  private constructor(matchSet: MatchSet, index: number) {
    this.matchSet = matchSet;
    this.index = Math.max(0, Math.min(index, matchSet.matches.length - 1));
    this.panel = vscode.window.createWebviewPanel(
      'assttyys.preview',
      `截图预览 - ${matchSet.label}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.panel.onDidDispose(() => {
      this.disposed = true;
      PreviewPanel.current = undefined;
    });
  }

  static disposeCurrent(): void {
    PreviewPanel.current?.dispose();
    PreviewPanel.current = undefined;
  }

  static show(matchSet: MatchSet, index = 0): void {
    if (matchSet.matches.length === 0) {
      void vscode.window.showInformationMessage(`[${matchSet.label}] 没有匹配的截图。`);
      return;
    }
    if (PreviewPanel.current) {
      PreviewPanel.current.setMatchSet(matchSet, index);
      PreviewPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    PreviewPanel.current = new PreviewPanel(matchSet, index);
  }

  private setMatchSet(matchSet: MatchSet, index: number): void {
    this.matchSet = matchSet;
    this.index = Math.max(0, Math.min(index, matchSet.matches.length - 1));
    this.panel.title = `截图预览 - ${matchSet.label}`;
    void this.sendCurrent();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const data = message as { type?: string; index?: number };
    const matches = this.matchSet.matches;
    switch (data.type) {
      case 'ready':
        await this.sendCurrent();
        break;
      case 'prev':
        this.index = (this.index - 1 + matches.length) % matches.length;
        await this.sendCurrent();
        break;
      case 'next':
        this.index = (this.index + 1) % matches.length;
        await this.sendCurrent();
        break;
      case 'select':
        if (typeof data.index === 'number' && data.index >= 0 && data.index < matches.length) {
          this.index = data.index;
          await this.sendCurrent();
        }
        break;
      case 'copy': {
        const current = matches[this.index];
        if (current) {
          await vscode.env.clipboard.writeText(current.path);
          void vscode.window.showInformationMessage(`已复制截图路径：${current.path}`);
        }
        break;
      }
      case 'reveal': {
        const current = matches[this.index];
        if (current) {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(current.path));
        }
        break;
      }
      case 'open': {
        const current = matches[this.index];
        if (current) {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(current.path));
        }
        break;
      }
      case 'togglePoints':
        this.showPoints = !this.showPoints;
        await this.sendCurrent();
        break;
      default:
        break;
    }
  }

  private async sendCurrent(): Promise<void> {
    if (this.disposed) return;
    const current = this.matchSet.matches[this.index];
    if (!current) return;

    let imageSrc: string;
    try {
      const buffer = await fs.readFile(current.path);
      imageSrc = `data:${mimeType(current.path)};base64,${buffer.toString('base64')}`;
    } catch (error) {
      void vscode.window.showErrorMessage(`读取截图失败：${current.path}（${String(error)}）`);
      return;
    }

    const payload: PreviewPayload = {
      type: 'render',
      index: this.index,
      total: this.matchSet.matches.length,
      label: this.matchSet.label,
      fileName: path.basename(current.path),
      filePath: current.path,
      imageSrc,
      width: current.width,
      height: current.height,
      points: current.points,
      anchor: current.anchor,
      showPoints: this.showPoints,
      files: this.matchSet.matches.map((match: ScreenshotMatch) => path.basename(match.path)),
    };
    await this.panel.webview.postMessage(payload);
  }

  private getHtml(): string {
    const nonce = getNonce();
    const title = escapeHtml(this.matchSet.label);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 12px; color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    display: flex; flex-direction: column; gap: 10px; min-height: 100vh;
  }
  .title { font-size: 15px; font-weight: 600; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  button, select {
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
    border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px;
    padding: 4px 9px; cursor: pointer; font: inherit;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    color: var(--vscode-secondaryButton-foreground, var(--vscode-foreground));
    background: var(--vscode-secondaryButton-background, var(--vscode-button-secondaryBackground));
  }
  select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); }
  .counter { min-width: 70px; text-align: center; opacity: .9; }
  main { flex: 1; min-height: 0; display: flex; justify-content: center; align-items: flex-start; }
  .stage { position: relative; display: inline-block; max-width: 100%; }
  #image { display: block; max-width: 100%; max-height: calc(100vh - 170px); object-fit: contain; }
  #overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  footer { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  #meta { opacity: .85; }
  #path { user-select: all; word-break: break-all; color: var(--vscode-descriptionForeground); }
  .hint { opacity: .7; font-size: 12px; }
</style>
</head>
<body>
  <div class="title">${title}</div>
  <div class="toolbar">
    <button id="prev" title="上一张（←）">‹ 上一张</button>
    <span class="counter" id="counter">- / -</span>
    <button id="next" title="下一张（→）">下一张 ›</button>
    <select id="selector" title="切换截图"></select>
    <button id="toggle" class="secondary">隐藏匹配点</button>
    <button id="open" class="secondary">打开原图</button>
    <button id="copy" class="secondary">复制路径</button>
    <button id="reveal" class="secondary">在资源管理器中显示</button>
  </div>
  <main>
    <div class="stage">
      <img id="image" alt="截图预览">
      <svg id="overlay" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
  </main>
  <footer>
    <div id="meta"></div>
    <code id="path"></code>
    <div class="hint">点击“复制路径”可复制当前截图的完整路径；左右方向键切换截图。</div>
  </footer>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const image = document.getElementById('image');
  const overlay = document.getElementById('overlay');
  const counter = document.getElementById('counter');
  const selector = document.getElementById('selector');
  const meta = document.getElementById('meta');
  const pathEl = document.getElementById('path');
  const toggle = document.getElementById('toggle');
  let state = null;
  let lastFilesKey = '';

  function drawOverlay() {
    overlay.innerHTML = '';
    if (!state || !state.width || !state.height) return;
    overlay.setAttribute('viewBox', '0 0 ' + state.width + ' ' + state.height);
    overlay.setAttribute('preserveAspectRatio', 'none');
    overlay.style.display = state.showPoints ? 'block' : 'none';
    if (!state.showPoints) return;
    const ns = 'http://www.w3.org/2000/svg';
    (state.points || []).forEach((point, index) => {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', String(index === 0 ? 14 : 10));
      circle.setAttribute('fill', index === 0 ? 'rgba(255, 140, 0, 0.25)' : 'rgba(0, 200, 0, 0.18)');
      circle.setAttribute('stroke', index === 0 ? '#ff8c00' : '#00c800');
      circle.setAttribute('stroke-width', '3');
      overlay.appendChild(circle);
    });
    const anchor = state.anchor;
    if (anchor) {
      const lineX = document.createElementNS(ns, 'line');
      lineX.setAttribute('x1', String(anchor.x - 18));
      lineX.setAttribute('y1', String(anchor.y));
      lineX.setAttribute('x2', String(anchor.x + 18));
      lineX.setAttribute('y2', String(anchor.y));
      lineX.setAttribute('stroke', '#ff4d4f');
      lineX.setAttribute('stroke-width', '2');
      overlay.appendChild(lineX);
      const lineY = document.createElementNS(ns, 'line');
      lineY.setAttribute('x1', String(anchor.x));
      lineY.setAttribute('y1', String(anchor.y - 18));
      lineY.setAttribute('x2', String(anchor.x));
      lineY.setAttribute('y2', String(anchor.y + 18));
      lineY.setAttribute('stroke', '#ff4d4f');
      lineY.setAttribute('stroke-width', '2');
      overlay.appendChild(lineY);
    }
  }

  function render(data) {
    state = data;
    image.src = data.imageSrc;
    counter.textContent = (data.index + 1) + ' / ' + data.total;
    meta.textContent = data.fileName + ' · ' + data.width + '×' + data.height + ' · 匹配点 ' + (data.points || []).length + ' 个';
    pathEl.textContent = data.filePath;
    toggle.textContent = data.showPoints ? '隐藏匹配点' : '显示匹配点';
    if (data.files && data.files.length > 0) {
      const filesKey = data.files.join('|');
      if (filesKey !== lastFilesKey) {
        lastFilesKey = filesKey;
        selector.innerHTML = '';
        data.files.forEach((name, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = (index + 1) + '. ' + name;
          selector.appendChild(option);
        });
      }
      selector.value = String(data.index);
    }
    drawOverlay();
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'render') return;
    render(data);
  });
  image.addEventListener('load', drawOverlay);
  document.getElementById('prev').addEventListener('click', () => vscode.postMessage({ type: 'prev' }));
  document.getElementById('next').addEventListener('click', () => vscode.postMessage({ type: 'next' }));
  document.getElementById('open').addEventListener('click', () => vscode.postMessage({ type: 'open' }));
  document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
  document.getElementById('reveal').addEventListener('click', () => vscode.postMessage({ type: 'reveal' }));
  toggle.addEventListener('click', () => vscode.postMessage({ type: 'togglePoints' }));
  selector.addEventListener('change', () => vscode.postMessage({ type: 'select', index: Number(selector.value) }));
  window.addEventListener('keydown', (event) => {
    if (event.target === selector) return;
    if (event.key === 'ArrowLeft') vscode.postMessage({ type: 'prev' });
    if (event.key === 'ArrowRight') vscode.postMessage({ type: 'next' });
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposed = true;
    this.panel.dispose();
  }
}
