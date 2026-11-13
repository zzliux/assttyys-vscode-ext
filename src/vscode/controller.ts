import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import type {
  MatchSet,
  PatternDefinition,
  ScreenshotMatch,
  StringReference,
} from '../core/model';
import { extractPatterns, isDetectFile, isFindFile, isRelevantFile } from '../core/extract';
import { extractNavigationLinks } from '../core/navigation';
import { DetectPatternIndex } from '../core/detectIndex';
import { ScreenshotIndex } from '../core/screenshotIndex';
import { MatcherService, type MatchCancellation } from '../core/matcherService';
import { MatchDiskCache } from '../core/matchDiskCache';
import { PreviewDocumentLinkProvider } from './documentLinks';
import { configKey, readConfig, type ExtensionConfig } from './config';
import { PreviewPanel } from './previewPanel';
import { InlayHintsProvider } from './inlayHints';

interface HintTarget {
  anchorOffset: number;
  label: string;
  stateKey: string;
  pattern: PatternDefinition;
}

interface DocumentState {
  version: number;
  configKey: string;
  generation: number;
  detectRevision: number;
  patterns: PatternDefinition[];
  references: StringReference[];
  targets: HintTarget[];
  matchesByPatternId: Map<string, ScreenshotMatch[]>;
  matchSets: Map<string, MatchSet>;
}

interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel(): void;
}

function debounce<Args extends unknown[]>(callback: (...args: Args) => void, delay: number): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  }) as Debounced<Args>;
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

function offsetRange(document: vscode.TextDocument, range: vscode.Range): { start: number; end: number } {
  return {
    start: document.offsetAt(range.start),
    end: document.offsetAt(range.end),
  };
}

/**
 * 插件主控制器：负责索引截图、解析文档、按可见范围匹配、生成 inlay hint 和预览。
 */
export class ExtensionController implements vscode.Disposable {
  private config: ExtensionConfig;
  private screenshots = new ScreenshotIndex();
  private matcher: MatcherService;
  private readonly diskCache: MatchDiskCache;
  private readonly detectIndex = new DetectPatternIndex('detect');
  private readonly findIndex = new DetectPatternIndex('find');
  private readonly states = new Map<string, DocumentState>();
  private readonly loadedDetectFiles = new Map<string, number>();
  private readonly loadedFindFiles = new Map<string, number>();
  private readonly warnedMissingDetect = new Set<string>();
  private readonly output: vscode.OutputChannel;
  private readonly statusBar: vscode.StatusBarItem;
  private readonly provider: InlayHintsProvider;
  private readonly documentLinkProvider: PreviewDocumentLinkProvider;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly screenshotWatchers: vscode.Disposable[] = [];
  private readonly invalidateTimer: Debounced<[string]>;
  private readonly detectReloadTimer: Debounced<[vscode.TextDocument]>;
  private readonly findReloadTimer: Debounced<[vscode.TextDocument]>;
  private readonly screenshotRefreshTimer: Debounced<[]>;
  private readonly projectPrecomputeTimer: Debounced<[]>;
  private detectRevision = 0;
  private initializing = true;
  private matchingRequests = 0;
  private projectPrecomputePromise: Promise<void> | null = null;
  private projectPrecomputeAgain = false;
  private projectPatternCount = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.config = readConfig();
    this.diskCache = new MatchDiskCache(
      path.join(context.globalStorageUri.fsPath, 'match-cache-v1.json'),
    );
    this.matcher = new MatcherService(this.screenshots, this.diskCache);
    this.matcher.setErrorHandler((message) => this.log(message));
    this.output = vscode.window.createOutputChannel('Assttyys 截图匹配');
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBar.command = 'assttyys.refresh';
    this.provider = new InlayHintsProvider((document, range, token) =>
      this.provideHints(document, range, token),
    );
    this.documentLinkProvider = new PreviewDocumentLinkProvider((document, token) =>
      this.provideDocumentLinks(document, token),
    );

    this.invalidateTimer = debounce((uri: string) => {
      this.invalidateDocument(uri);
    }, 350);
    this.detectReloadTimer = debounce((document: vscode.TextDocument) => {
      void this.reloadDetectDocument(document);
    }, 350);
    this.findReloadTimer = debounce((document: vscode.TextDocument) => {
      void this.reloadFindDocument(document);
    }, 350);
    this.screenshotRefreshTimer = debounce(() => {
      void this.refreshScreenshotsAndMatches('截图文件变化');
    }, 700);
    this.projectPrecomputeTimer = debounce(() => {
      void this.ensureProjectPrecomputed();
    }, 500);
  }

  async initialize(): Promise<void> {
    this.disposables.push(
      vscode.languages.registerInlayHintsProvider({ language: 'typescript' }, this.provider),
      vscode.languages.registerDocumentLinkProvider(
        { language: 'typescript' },
        this.documentLinkProvider,
      ),
    );

    this.statusBar.show();
    this.setStatusScanning();

    this.registerEvents();
    await this.loadWorkspaceDetectFiles();
    await this.refreshScreenshotsAndMatches('启动', false);
    this.setupScreenshotWatchers();
    this.initializing = false;
    this.updateStatus();
    // 后台预匹配项目内所有比色 desc；第一次打开文件时如果还没完成会等它。
    void this.ensureProjectPrecomputed();
  }

  private registerEvents(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.config.autoRefresh) return;
        const document = event.document;
        if (isDetectFile(document.fileName)) {
          this.invalidateTimer(document.uri.toString());
          this.detectReloadTimer(document);
          return;
        }
        if (isFindFile(document.fileName)) {
          this.findReloadTimer(document);
          return;
        }
        if (isRelevantFile(document.fileName)) {
          this.invalidateTimer(document.uri.toString());
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!isRelevantFile(document.fileName)) return;
        if (isDetectFile(document.fileName)) {
          this.detectReloadTimer.cancel();
          void this.reloadDetectDocument(document);
        }
        if (isFindFile(document.fileName)) {
          this.findReloadTimer.cancel();
          void this.reloadFindDocument(document);
        }
        this.invalidateDocument(document.uri.toString(), document.version);
        this.scheduleProjectPrecompute();
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isDetectFile(document.fileName)) {
          void this.reloadDetectDocument(document);
        } else if (isFindFile(document.fileName)) {
          void this.reloadFindDocument(document);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('assttyys')) return;
        void this.reconfigure();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.initializeWorkspace();
      }),
    );
  }

  private async initializeWorkspace(): Promise<void> {
    this.detectIndex.clear();
    this.findIndex.clear();
    this.loadedDetectFiles.clear();
    this.loadedFindFiles.clear();
    this.detectRevision++;
    this.invalidateAll();
    await this.loadWorkspaceDetectFiles();
    await this.refreshScreenshotsAndMatches('工作区变化');
    this.setupScreenshotWatchers();
    this.scheduleProjectPrecompute();
  }

  private async loadWorkspaceDetectFiles(): Promise<void> {
    try {
      const [detectFiles, findFiles] = await Promise.all([
        vscode.workspace.findFiles('**/src/common/multiDetectColors.ts', '**/node_modules/**', 50),
        vscode.workspace.findFiles('**/src/common/multiFindColors.ts', '**/node_modules/**', 50),
      ]);
      for (const uri of detectFiles) await this.loadDetectFile(uri);
      for (const uri of findFiles) await this.loadFindFile(uri);

      // 已经打开、但不在工作区内的定义文件。
      for (const document of vscode.workspace.textDocuments) {
        if (document.uri.scheme !== 'file') continue;
        if (isDetectFile(document.fileName)) await this.loadDetectDocument(document);
        if (isFindFile(document.fileName)) await this.loadFindDocument(document);
      }
    } catch (error) {
      this.log(`加载定义索引失败：${String(error)}`);
    }
  }

  private async loadDetectDocument(document: vscode.TextDocument): Promise<void> {
    if (document.uri.scheme !== 'file') return;
    const filePath = document.fileName;
    const previous = this.loadedDetectFiles.get(filePath);
    if (previous === document.version) return;
    const result = extractPatterns(filePath, document.version, document.getText());
    this.loadedDetectFiles.set(filePath, document.version);
    this.detectIndex.update(filePath, result.patterns);
    this.detectRevision++;
    this.invalidateAll();
    this.log(`加载比色定义：${filePath}（${result.patterns.length} 条）`);
  }

  private async loadDetectFile(uri: vscode.Uri): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await this.loadDetectDocument(document);
    } catch (error) {
      this.log(`读取比色定义失败：${uri.fsPath}（${String(error)}）`);
    }
  }

  private async reloadDetectDocument(document: vscode.TextDocument): Promise<void> {
    if (this.initializing) return;
    await this.loadDetectDocument(document);
    this.refreshMarkerProviders();
  }

  private async loadFindDocument(document: vscode.TextDocument): Promise<void> {
    if (document.uri.scheme !== 'file') return;
    const filePath = document.fileName;
    const previous = this.loadedFindFiles.get(filePath);
    if (previous === document.version) return;
    const result = extractPatterns(filePath, document.version, document.getText());
    this.loadedFindFiles.set(filePath, document.version);
    this.findIndex.update(filePath, result.patterns);
    this.documentLinkProvider.refresh();
    this.log(`加载找色定义：${filePath}（${result.patterns.length} 条）`);
  }

  private async loadFindFile(uri: vscode.Uri): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await this.loadFindDocument(document);
    } catch (error) {
      this.log(`读取找色定义失败：${uri.fsPath}（${String(error)}）`);
    }
  }

  private async reloadFindDocument(document: vscode.TextDocument): Promise<void> {
    if (this.initializing) return;
    await this.loadFindDocument(document);
  }

  private scheduleProjectPrecompute(): void {
    if (this.screenshots.entries.length === 0) return;
    if (this.projectPrecomputePromise) {
      this.projectPrecomputeAgain = true;
      return;
    }
    this.projectPrecomputeTimer();
  }

  /**
   * 项目级比色预匹配。
   *
   * 把 workspace 内 multiDetectColors.ts + funcList 里所有内联 desc 一起做一次
   * 图优先匹配。结果进入 MatcherService 的 desc 签名缓存和磁盘缓存，之后打开
   * 任何功能文件都直接命中，不再为每个文件重新解码截图。
   */
  private ensureProjectPrecomputed(): Promise<void> {
    if (this.projectPrecomputePromise) return this.projectPrecomputePromise;
    if (this.screenshots.entries.length === 0) return Promise.resolve();

    const promise = this.runProjectPrecompute().finally(() => {
      if (this.projectPrecomputePromise === promise) this.projectPrecomputePromise = null;
      if (this.projectPrecomputeAgain) {
        this.projectPrecomputeAgain = false;
        void this.ensureProjectPrecomputed();
      }
    });
    this.projectPrecomputePromise = promise;
    return promise;
  }

  private async runProjectPrecompute(): Promise<void> {
    if (this.screenshots.entries.length === 0) return;
    const started = Date.now();
    const generation = this.screenshots.generation;
    try {
      const patterns = await this.collectProjectDetectPatterns();
      this.projectPatternCount = patterns.length;
      if (patterns.length === 0) return;

      this.beginMatching();
      try {
        await this.matcher.matchPatternsBatch(patterns, this.matcherOptions());
      } finally {
        this.endMatching();
      }
      this.log(
        `[项目预匹配] ${patterns.length} 个比色 desc，耗时 ${Date.now() - started}ms`,
      );
      if (generation !== this.screenshots.generation) {
        this.scheduleProjectPrecompute();
      }
    } catch (error) {
      this.log(`项目预匹配失败：${String(error)}`);
    }
  }

  private async collectProjectDetectPatterns(): Promise<PatternDefinition[]> {
    const exclude = '**/{node_modules,.git,.refs}/**';
    const [detectFiles, funcFiles] = await Promise.all([
      vscode.workspace.findFiles('**/src/common/multiDetectColors.ts', exclude, 100),
      vscode.workspace.findFiles('**/src/common/funcList/**/*.ts', exclude, 5000),
    ]);

    const openDocuments = new Map<string, vscode.TextDocument>();
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === 'file' && isRelevantFile(document.fileName)) {
        openDocuments.set(document.fileName, document);
      }
    }

    const paths = new Set<string>();
    for (const uri of [...detectFiles, ...funcFiles]) {
      const normalized = uri.fsPath.replace(/\\/g, '/');
      if (/\/(node_modules|\.git|\.refs)\//.test(normalized)) continue;
      paths.add(uri.fsPath);
    }
    for (const filePath of openDocuments.keys()) paths.add(filePath);

    const patterns: PatternDefinition[] = [];
    for (const filePath of paths) {
      try {
        const document = openDocuments.get(filePath);
        const text = document ? document.getText() : await fs.readFile(filePath, 'utf8');
        const result = extractPatterns(filePath, document?.version ?? 1, text);
        for (const pattern of result.patterns) {
          if (pattern.kind !== 'find') patterns.push(pattern);
        }
      } catch (error) {
        this.log(`项目预匹配读取失败：${filePath}（${String(error)}）`);
      }
    }
    return patterns;
  }

  async provideHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlayHint[]> {
    if (document.uri.scheme !== 'file' || !isRelevantFile(document.fileName)) return [];
    if (this.screenshots.entries.length === 0) return [];

    try {
      const matched = await this.getMatchedTargets(document, range, token);
      if (!matched || token.isCancellationRequested) return [];
      return matched.targets
        .filter((target) => (matched.state.matchesByPatternId.get(target.pattern.id) ?? []).length > 0)
        .map((target) =>
          this.makeHint(
            document,
            target,
            (matched.state.matchesByPatternId.get(target.pattern.id) ?? []).length,
          ),
        );
    } catch (error) {
      this.log(`解析/匹配失败：${document.fileName}（${String(error)}）`);
      return [];
    }
  }

  private async getMatchedTargets(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken,
  ): Promise<{ state: DocumentState; targets: HintTarget[] } | undefined> {
    const state = await this.ensureState(document);
    if (!state || token.isCancellationRequested) return undefined;

    const { start, end } = offsetRange(document, range);
    const targets = state.targets.filter(
      (target) => target.anchorOffset >= start && target.anchorOffset <= end,
    );
    if (targets.length === 0) return undefined;

    // 比色/内联定义的成本主要是“把同分辨率截图解码一遍”；一次把当前文件里
    // 所有比色 desc 都匹配掉，后续滚动/切换可见区域就不再重复解码。
    // 找色需要逐像素搜索，仍然只匹配当前可见区域。
    const hasFindPattern = state.patterns.some((pattern) => pattern.kind === 'find');
    if (!hasFindPattern) await this.ensureProjectPrecomputed();
    if (token.isCancellationRequested) return undefined;
    const matchTargets = hasFindPattern ? targets : state.targets;

    const pendingPatterns = Array.from(
      new Map(
        matchTargets
          .filter((target) => !state.matchesByPatternId.has(target.pattern.id))
          .map((target) => [target.pattern.id, target.pattern]),
      ).values(),
    );
    if (pendingPatterns.length > 0) {
      this.beginMatching();
      try {
        const matched = await this.matcher.matchPatternsBatch(
          pendingPatterns,
          this.matcherOptions(),
          token as MatchCancellation,
        );
        for (const [patternId, matches] of matched) {
          state.matchesByPatternId.set(patternId, matches);
        }
        if (token.isCancellationRequested) return undefined;
      } finally {
        this.endMatching();
      }
    }
    if (token.isCancellationRequested) return undefined;

    for (const target of matchTargets) {
      const matches = state.matchesByPatternId.get(target.pattern.id) ?? [];
      if (matches.length === 0) continue;
      state.matchSets.set(
        target.stateKey,
        this.matcher.makeMatchSet(target.stateKey, target.label, target.pattern, matches),
      );
    }
    return { state, targets };
  }

  private makeHint(document: vscode.TextDocument, target: HintTarget, matchCount: number): vscode.InlayHint {
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${target.label}**\n\n`);
    markdown.appendMarkdown(
      `分辨率：${target.pattern.resolution.width}×${target.pattern.resolution.height}\n\n`,
    );
    markdown.appendMarkdown(`匹配截图：${matchCount} 张\n\n`);
    markdown.appendMarkdown('点击预览，可切换截图并复制路径。');
    markdown.isTrusted = false;

    const label = matchCount > 1 ? `📷 ${matchCount}` : '📷';
    const part = new vscode.InlayHintLabelPart(label);
    part.tooltip = markdown;
    part.command = {
      title: '预览匹配截图',
      command: 'assttyys.previewMatch',
      arguments: [document.uri.toString(), target.stateKey],
    };
    const hint = new vscode.InlayHint(
      document.positionAt(target.anchorOffset),
      [part],
      vscode.InlayHintKind.Parameter,
    );
    hint.paddingLeft = true;
    hint.tooltip = markdown;
    return hint;
  }

  async provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentLink[]> {
    if (document.uri.scheme !== 'file' || !isRelevantFile(document.fileName)) return [];

    try {
      const links: vscode.DocumentLink[] = [];
      const targetDocuments = new Map<string, vscode.TextDocument>();

      const targetPosition = async (
        targetUri: vscode.Uri,
        offset: number,
      ): Promise<vscode.Position | undefined> => {
        if (targetUri.toString() === document.uri.toString()) {
          return document.positionAt(offset);
        }
        let targetDocument = targetDocuments.get(targetUri.toString());
        if (!targetDocument) {
          targetDocument = await vscode.workspace.openTextDocument(targetUri);
          targetDocuments.set(targetUri.toString(), targetDocument);
        }
        return targetDocument.positionAt(offset);
      };

      for (const nav of extractNavigationLinks(document.getText(), document.fileName)) {
        if (token.isCancellationRequested) break;

        let targetUri = document.uri;
        let targetOffset: number | undefined;

        if (nav.kind === 'same-operator') {
          targetOffset = nav.targetOffset;
        } else if (nav.kind === 'detect' && nav.key) {
          let pattern = this.detectIndex.resolve(document.fileName, nav.key);
          if (!pattern) {
            await this.ensureDetectKey(document.fileName, nav.key);
            pattern = this.detectIndex.resolve(document.fileName, nav.key);
          }
          if (!pattern) continue;
          targetUri = vscode.Uri.file(pattern.uri);
          targetOffset = pattern.keyOffset ?? pattern.startOffset ?? pattern.anchorOffset;
        } else if (nav.kind === 'find' && nav.key) {
          let pattern = this.findIndex.resolve(document.fileName, nav.key);
          if (!pattern) {
            await this.ensureFindFor(document.fileName, nav.key);
            pattern = this.findIndex.resolve(document.fileName, nav.key);
          }
          if (!pattern) continue;
          targetUri = vscode.Uri.file(pattern.uri);
          targetOffset = pattern.keyOffset ?? pattern.startOffset ?? pattern.anchorOffset;
        }

        if (targetOffset === undefined) continue;
        const position = await targetPosition(targetUri, targetOffset);
        if (!position) continue;
        const start = document.positionAt(nav.startOffset);
        const end = document.positionAt(nav.endOffset);
        if (start.isEqual(end)) continue;
        const link = new vscode.DocumentLink(
          new vscode.Range(start, end),
          targetUri.with({ fragment: `L${position.line + 1},${position.character + 1}` }),
        );
        link.tooltip = nav.tooltip;
        links.push(link);
      }
      return links;
    } catch (error) {
      this.log(`生成跳转链接失败：${document.fileName}（${String(error)}）`);
      return [];
    }
  }

  private async ensureState(document: vscode.TextDocument): Promise<DocumentState | undefined> {
    if (!isRelevantFile(document.fileName)) return undefined;
    const uri = document.uri.toString();
    const cached = this.states.get(uri);
    if (
      cached &&
      cached.version === document.version &&
      cached.configKey === configKey(this.config) &&
      cached.generation === this.screenshots.generation &&
      cached.detectRevision === this.detectRevision
    ) {
      return cached;
    }

    const result = extractPatterns(document.fileName, document.version, document.getText());
    const targets: HintTarget[] = result.patterns.map((pattern) => ({
      anchorOffset: pattern.anchorOffset,
      label: pattern.label,
      stateKey: pattern.id,
      pattern,
    }));

    // 字符串引用和动态 thisOperator[N].desc 都需要先解析同项目定义。
    if (result.references.length > 0) {
      await this.ensureDetectFor(document.fileName, result.references);
    }

    const operatorTargets = new Map<number, PatternDefinition>();
    for (const pattern of result.patterns) {
      if (pattern.operatorIndex === undefined) continue;
      if (!operatorTargets.has(pattern.operatorIndex)) {
        operatorTargets.set(pattern.operatorIndex, pattern);
      }
    }
    for (const reference of result.references) {
      if (reference.operatorIndex === undefined) continue;
      const pattern = this.detectIndex.resolve(document.fileName, reference.key);
      if (pattern && !operatorTargets.has(reference.operatorIndex)) {
        operatorTargets.set(reference.operatorIndex, pattern);
      }
    }

    if (this.config.showStringReferences) {
      for (const reference of result.references) {
        const pattern = this.detectIndex.resolve(document.fileName, reference.key);
        if (!pattern) {
          if (!this.warnedMissingDetect.has(`${document.fileName}:${reference.key}`)) {
            this.warnedMissingDetect.add(`${document.fileName}:${reference.key}`);
            this.log(`未找到字符串引用对应的比色定义：${reference.key}（${document.fileName}）`);
          }
          continue;
        }
        targets.push({
          anchorOffset: reference.anchorOffset,
          label: reference.key,
          stateKey: reference.id,
          pattern,
        });
      }
    }

    // `desc: thisOperator[N].desc` 直接用 operator[N] 的目标 desc 缓存匹配。
    for (const dynamic of result.dynamicReferences) {
      const pattern = operatorTargets.get(dynamic.targetOperatorIndex);
      if (!pattern) continue;
      targets.push({
        anchorOffset: dynamic.anchorOffset,
        label: dynamic.label,
        stateKey: dynamic.id,
        pattern,
      });
    }

    const state: DocumentState = {
      version: document.version,
      configKey: configKey(this.config),
      generation: this.screenshots.generation,
      detectRevision: this.detectRevision,
      patterns: result.patterns,
      references: result.references,
      targets,
      matchesByPatternId: new Map(),
      matchSets: new Map(),
    };
    this.states.set(uri, state);
    return state;
  }

  private async ensureDetectFor(filePath: string, references: StringReference[]): Promise<void> {
    if (references.length === 0) return;
    const unresolved = references.some((reference) => !this.detectIndex.resolve(filePath, reference.key));
    if (!unresolved) return;

    const detectFile = await this.findDefinitionFileNear(filePath, 'multiDetectColors.ts');
    if (!detectFile) return;
    if (this.loadedDetectFiles.has(detectFile)) return;
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(detectFile));
      await this.loadDetectDocument(document);
    } catch (error) {
      this.log(`尝试加载同目录比色定义失败：${detectFile}（${String(error)}）`);
    }
  }

  private async ensureDetectKey(filePath: string, key: string): Promise<void> {
    if (this.detectIndex.resolve(filePath, key)) return;
    const detectFile = await this.findDefinitionFileNear(filePath, 'multiDetectColors.ts');
    if (!detectFile || this.loadedDetectFiles.has(detectFile)) return;
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(detectFile));
      await this.loadDetectDocument(document);
    } catch (error) {
      this.log(`尝试加载同目录比色定义失败：${detectFile}（${String(error)}）`);
    }
  }

  private async ensureFindFor(filePath: string, key: string): Promise<void> {
    if (this.findIndex.resolve(filePath, key)) return;
    const findFile = await this.findDefinitionFileNear(filePath, 'multiFindColors.ts');
    if (!findFile) return;
    if (this.loadedFindFiles.has(findFile)) return;
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(findFile));
      await this.loadFindDocument(document);
    } catch (error) {
      this.log(`尝试加载同目录找色定义失败：${findFile}（${String(error)}）`);
    }
  }

  private async findDefinitionFileNear(
    filePath: string,
    baseName: string,
  ): Promise<string | undefined> {
    let directory = path.dirname(filePath);
    for (let depth = 0; depth < 8; depth++) {
      const candidate = path.join(directory, baseName);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        // 继续向上查找。
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return undefined;
  }

  private matcherOptions() {
    return {
      colorSimilarity: this.config.colorSimilarity,
      findColorSimilarity: this.config.findColorSimilarity,
      findColorOffset: this.config.findColorOffset,
      maxMatchesPerPattern: this.config.maxMatchesPerPattern,
      findColorScanLimit: this.config.findColorScanLimit,
    };
  }

  async previewMatch(uriString: string, stateKey: string): Promise<void> {
    try {
      const uri = vscode.Uri.parse(uriString);
      const document = await vscode.workspace.openTextDocument(uri);
      const set = await this.getMatchSet(document, stateKey);
      if (!set) {
        void vscode.window.showInformationMessage('该匹配已失效，请稍后重试（文件可能已修改）。');
        return;
      }
      PreviewPanel.show(set);
    } catch (error) {
      this.log(`打开预览失败：${String(error)}`);
      void vscode.window.showErrorMessage(`打开预览失败：${String(error)}`);
    }
  }

  async previewAtCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage('请先打开一个功能/比色/找色定义文件。');
      return;
    }
    const document = editor.document;
    if (!isRelevantFile(document.fileName)) {
      void vscode.window.showInformationMessage('当前文件不是 assttyys 的定义文件。');
      return;
    }
    const state = await this.ensureState(document);
    if (!state || state.targets.length === 0) {
      void vscode.window.showInformationMessage('当前文件没有解析到比色/找色定义。');
      return;
    }
    const cursorLine = editor.selection.active.line;
    let target = state.targets.find((item) => {
      const line = document.positionAt(item.anchorOffset).line;
      return line === cursorLine;
    });
    if (!target) {
      // 光标在数组内部时，选择结束行离光标最近的提示。
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const item of state.targets) {
        const line = document.positionAt(item.anchorOffset).line;
        const distance = Math.abs(line - cursorLine);
        if (distance < bestDistance) {
          bestDistance = distance;
          target = item;
        }
      }
      if (bestDistance > 3) target = undefined;
    }
    if (!target) {
      void vscode.window.showInformationMessage('光标附近没有匹配的 desc 定义。');
      return;
    }
    const set = await this.getMatchSet(document, target.stateKey);
    if (!set) {
      void vscode.window.showInformationMessage(`[${target.label}] 没有匹配的截图。`);
      return;
    }
    PreviewPanel.show(set);
  }

  private async getMatchSet(
    document: vscode.TextDocument,
    stateKey: string,
  ): Promise<MatchSet | undefined> {
    const state = await this.ensureState(document);
    if (!state) return undefined;
    const existing = state.matchSets.get(stateKey);
    if (existing) return existing;

    const target = state.targets.find((item) => item.stateKey === stateKey);
    if (!target) return undefined;
    let matches = state.matchesByPatternId.get(target.pattern.id);
    if (!matches) {
      this.beginMatching();
      try {
        matches = await this.matcher.matchPattern(target.pattern, this.matcherOptions());
        state.matchesByPatternId.set(target.pattern.id, matches);
      } finally {
        this.endMatching();
      }
    }
    if (matches.length === 0) return undefined;
    const set = this.matcher.makeMatchSet(stateKey, target.label, target.pattern, matches);
    state.matchSets.set(stateKey, set);
    return set;
  }

  async refreshScreenshotsAndMatches(reason: string, showMessage = true): Promise<void> {
    if (this.screenshots.entries.length === 0 && this.config.screenshotPaths.length > 0) {
      this.setStatusScanning();
    }
    if (this.config.screenshotPaths.length === 0) {
      this.screenshots.clear();
      this.matcher.invalidate();
      this.invalidateAll();
      this.updateStatus();
      if (showMessage) {
        void vscode.window.showWarningMessage('尚未配置 Assttyys 截图路径。');
      }
      return;
    }

    this.setStatusScanning();
    const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.fsPath,
    );
    const cwd = workspaceFolders[0] ?? process.cwd();
    try {
      const changed = await this.screenshots.rebuild(this.config.screenshotPaths, {
        includeSubfolders: this.config.includeSubfolders,
        extensions: this.config.extensions,
        workspaceFolders,
        cwd,
      });
      if (changed) {
        this.matcher.invalidate();
        this.invalidateAll();
        this.refreshMarkerProviders();
        this.scheduleProjectPrecompute();
      }
      this.updateStatus();
      this.log(
        `[${reason}] 扫描到 ${this.screenshots.entries.length} 张截图${
          this.screenshots.resolutionSummary ? `（${this.screenshots.resolutionSummary}）` : ''
        }${changed ? '，截图集合有变化，已重新匹配' : '，截图集合未变化，复用已有匹配缓存'}`,
      );
      for (const error of this.screenshots.errors) this.log(`  - ${error}`);
    } catch (error) {
      this.log(`刷新截图失败：${String(error)}`);
      this.statusBar.text = '$(error) 截图扫描失败';
      this.statusBar.tooltip = String(error);
      if (showMessage) void vscode.window.showErrorMessage(`刷新截图失败：${String(error)}`);
    }
  }

  private async reconfigure(): Promise<void> {
    const next = readConfig();
    const refsChanged = next.showStringReferences !== this.config.showStringReferences;
    this.config = next;
    if (refsChanged) {
      this.detectIndex.clear();
      this.loadedDetectFiles.clear();
      this.detectRevision++;
      await this.loadWorkspaceDetectFiles();
    }
    this.invalidateAll();
    this.setupScreenshotWatchers();
    await this.refreshScreenshotsAndMatches('配置变化');
    this.scheduleProjectPrecompute();
  }

  async showStats(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const lines: string[] = [];
    lines.push(`截图目录：${this.config.screenshotPaths.length} 个`);
    lines.push(`索引截图：${this.screenshots.entries.length} 张`);
    if (this.screenshots.resolutionSummary) lines.push(`分辨率分布：${this.screenshots.resolutionSummary}`);
    lines.push(`比色定义索引：${this.detectIndex.size} 条`);
    lines.push(`项目比色预匹配 desc：${this.projectPatternCount} 条`);
    if (this.screenshots.scannedAt) lines.push(`最后扫描：${this.screenshots.scannedAt.toLocaleString()}`);
    if (this.screenshots.errors.length > 0) {
      lines.push(`扫描错误：${this.screenshots.errors.length} 条`);
      for (const error of this.screenshots.errors) lines.push(`  - ${error}`);
    }
    if (editor && isRelevantFile(editor.document.fileName)) {
      const result = extractPatterns(
        editor.document.fileName,
        editor.document.version,
        editor.document.getText(),
      );
      lines.push('');
      lines.push(`当前文件：${editor.document.fileName}`);
      lines.push(`内联/定义数组：${result.patterns.length} 条`);
      lines.push(`字符串引用：${result.references.length} 条`);
      const resolved = result.references.filter((reference) =>
        this.detectIndex.resolve(editor.document.fileName, reference.key),
      ).length;
      lines.push(`已解析引用：${resolved} 条`);
      const state = this.states.get(editor.document.uri.toString());
      if (state) {
        const matched = state.targets.filter(
          (target) => (state.matchesByPatternId.get(target.pattern.id) ?? []).length > 0,
        ).length;
        lines.push(`已匹配 desc：${matched} / ${state.targets.length}`);
      }
    } else {
      lines.push('');
      lines.push('当前没有打开 assttyys 定义文件。');
    }

    this.output.show(true);
    this.output.appendLine('---------- 统计 ----------');
    for (const line of lines) this.output.appendLine(line);
    this.output.appendLine('--------------------------');
    void vscode.window.showInformationMessage(
      `截图 ${this.screenshots.entries.length} 张，比色定义 ${this.detectIndex.size} 条。详情见输出面板。`,
    );
  }

  private setupScreenshotWatchers(): void {
    for (const watcher of this.screenshotWatchers) watcher.dispose();
    this.screenshotWatchers.length = 0;
    if (!this.config.autoRefresh) return;

    const extensions = this.config.extensions
      .map((extension) => extension.replace(/^\./, '').toLowerCase())
      .filter((extension) => extension === 'png' || extension === 'jpg' || extension === 'jpeg');
    const extensionPart = extensions.length > 0 ? `{${extensions.join(',')}}` : '{png,jpg,jpeg}';

    for (const rawPath of this.config.screenshotPaths) {
      const target = this.resolveWatchTarget(rawPath, extensionPart);
      if (!target) continue;
      try {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(target.base, target.pattern),
        );
        const refresh = () => this.screenshotRefreshTimer();
        watcher.onDidCreate(refresh);
        watcher.onDidChange(refresh);
        watcher.onDidDelete(refresh);
        this.screenshotWatchers.push(watcher);
      } catch (error) {
        this.log(`创建截图监听失败：${rawPath}（${String(error)}）`);
      }
    }
  }

  private resolveWatchTarget(
    rawPath: string,
    extensionPart: string,
  ): { base: string; pattern: string } | undefined {
    let value = rawPath.trim();
    if (!value) return undefined;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    value = value.replace(
      /\$\{workspaceFolder\}/g,
      folder?.uri.fsPath ?? process.cwd(),
    );
    value = value.replace(/\$\{env:([^}]+)\}/g, (_match, name: string) => process.env[name] ?? '');
    if (value.startsWith('~')) {
      value = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', value.slice(1));
    }

    const magic = value.search(/[*?[\]{}()!]/);
    if (magic >= 0) {
      let base = value.slice(0, magic);
      const lastSlash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
      base = lastSlash >= 0 ? base.slice(0, lastSlash) : '.';
      if (!path.isAbsolute(base)) {
        base = path.resolve(folder?.uri.fsPath ?? process.cwd(), base);
      }
      return { base: path.normalize(base), pattern: `**/*.${extensionPart}` };
    }

    if (!path.isAbsolute(value)) {
      value = path.resolve(folder?.uri.fsPath ?? process.cwd(), value);
    }
    value = path.normalize(value);
    try {
      const stat = statSync(value);
      if (stat.isFile()) {
        return { base: path.dirname(value), pattern: path.basename(value) };
      }
      if (stat.isDirectory()) {
        return { base: value, pattern: `**/*.${extensionPart}` };
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private invalidateDocument(uri: string, version?: number): void {
    const state = this.states.get(uri);
    if (!state) return;
    // 保存但没有实际修改时 version 不变，不需要丢掉匹配缓存。
    if (version !== undefined && state.version === version) return;
    this.states.delete(uri);
    this.refreshMarkerProviders();
  }

  private invalidateAll(): void {
    this.states.clear();
  }

  private refreshMarkerProviders(): void {
    this.provider.refresh();
    this.documentLinkProvider.refresh();
  }

  private setStatusScanning(): void {
    this.statusBar.text = '$(sync~spin) 扫描截图...';
    this.statusBar.tooltip = '正在扫描配置的截图目录';
  }

  private beginMatching(): void {
    this.matchingRequests++;
    if (this.matchingRequests === 1) {
      this.statusBar.text = '$(sync~spin) 匹配截图...';
      this.statusBar.tooltip = '正在解码截图并匹配当前可见的 desc';
    }
  }

  private endMatching(): void {
    this.matchingRequests = Math.max(0, this.matchingRequests - 1);
    if (this.matchingRequests === 0) this.updateStatus();
  }

  private updateStatus(): void {
    if (this.config.screenshotPaths.length === 0) {
      this.statusBar.text = '$(camera) 未配置截图目录';
      this.statusBar.tooltip = '点击运行 Assttyys: 刷新截图与匹配；或打开设置配置 assttyys.screenshotPaths';
      return;
    }
    this.statusBar.text = `$(camera) 截图 ${this.screenshots.entries.length}`;
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**Assttyys 截图匹配**\n\n`);
    tooltip.appendMarkdown(`截图：${this.screenshots.entries.length} 张\n\n`);
    if (this.screenshots.resolutionSummary) {
      tooltip.appendMarkdown(`分辨率：${this.screenshots.resolutionSummary}\n\n`);
    }
    tooltip.appendMarkdown(`比色定义：${this.detectIndex.size} 条\n\n`);
    tooltip.appendMarkdown(`项目比色预匹配：${this.projectPatternCount} 条\n\n`);
    tooltip.appendMarkdown(`找色扫描：最近 ${this.config.findColorScanLimit} 张\n\n`);
    if (this.screenshots.scannedAt) {
      tooltip.appendMarkdown(`最后扫描：${this.screenshots.scannedAt.toLocaleString()}\n\n`);
    }
    tooltip.appendMarkdown('点击刷新截图与匹配。');
    this.statusBar.tooltip = tooltip;
  }

  showOutput(): void {
    this.output.show(true);
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  }

  dispose(): void {
    this.invalidateTimer.cancel();
    this.detectReloadTimer.cancel();
    this.findReloadTimer.cancel();
    this.screenshotRefreshTimer.cancel();
    this.projectPrecomputeTimer.cancel();
    void this.matcher.flushCache();
    for (const watcher of this.screenshotWatchers) watcher.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.provider.dispose();
    this.documentLinkProvider.dispose();
    PreviewPanel.disposeCurrent();
    this.statusBar.dispose();
    this.output.dispose();
  }
}
