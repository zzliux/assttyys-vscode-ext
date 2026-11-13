import crypto from 'node:crypto';
import type {
  MatchSet,
  MatcherOptions,
  PatternDefinition,
  ScreenshotMatch,
} from './model';
import type { ScreenshotEntry, ScreenshotIndex } from './screenshotIndex';
import type { MatchDiskCache, PatternCacheEntry } from './matchDiskCache';
import { decodeImageFile } from './imageLoader';
import { matchDetect, matchFind } from './matcher';

export interface MatchCancellation {
  readonly isCancellationRequested: boolean;
}

interface InMemoryCacheItem {
  optionsKey: string;
  entry: PatternCacheEntry;
}

interface PendingPattern {
  pattern: PatternDefinition;
  matches: ScreenshotMatch[];
  evaluated: Record<string, string>;
  candidates: ScreenshotEntry[];
  candidatePaths: Set<string>;
  pending: Map<string, ScreenshotEntry>;
}

/**
 * 只对“会影响匹配结果”的字段做签名。
 *
 * 文件版本号、行号、key/label 都不参与，所以只改注释、调整排版、甚至改描述
 * 文字时，只要 desc 的坐标/颜色/容差没变，就能命中旧缓存。
 *
 * 找色扫描张数不参与签名：扫描范围只影响“还没评估哪些图”，不影响已有结果。
 */
function optionsKey(options: MatcherOptions): string {
  return [
    options.colorSimilarity,
    options.findColorSimilarity,
    options.findColorOffset,
    options.maxMatchesPerPattern,
  ].join('|');
}

function resolutionKey(pattern: PatternDefinition): string {
  return `${pattern.resolution.width}x${pattern.resolution.height}`;
}

function screenshotKey(entry: ScreenshotEntry): string {
  return `${entry.mtimeMs}|${entry.size}|${entry.width}x${entry.height}`;
}

function patternSignature(pattern: PatternDefinition): string {
  const payload = JSON.stringify({
    kind: pattern.kind,
    resolution: pattern.resolution,
    points: pattern.points,
    region: pattern.region,
    similarity: pattern.similarity,
  });
  return crypto.createHash('sha1').update(payload).digest('hex');
}

/**
 * 把定义、截图索引和增量缓存串起来。
 *
 * 匹配按“每张图解码一次、同时测试多个 desc”执行；缓存按 pattern 记录
 * 已经评估过的截图，新增截图只补匹配新图，不会清空旧结果。
 */
export class MatcherService {
  private readonly cache = new Map<string, InMemoryCacheItem>();
  private onError: (message: string) => void = () => {};

  constructor(
    private readonly screenshots: ScreenshotIndex,
    private readonly diskCache?: MatchDiskCache,
  ) {}

  setErrorHandler(handler: (message: string) => void): void {
    this.onError = handler;
  }

  async matchPattern(
    pattern: PatternDefinition,
    options: MatcherOptions,
    token?: MatchCancellation,
  ): Promise<ScreenshotMatch[]> {
    const result = await this.matchPatternsBatch([pattern], options, token);
    return result.get(pattern.id) ?? [];
  }

  /**
   * 批量匹配。图片在外层，一次解码同时测试所有还没评估过该图的 pattern。
   */
  async matchPatternsBatch(
    patterns: PatternDefinition[],
    options: MatcherOptions,
    token?: MatchCancellation,
    onProgress?: (done: number, total: number) => void,
    yieldToUi = false,
    maxNewImages = 0,
  ): Promise<Map<string, ScreenshotMatch[]>> {
    const result = new Map<string, ScreenshotMatch[]>();
    if (token?.isCancellationRequested) return result;

    const signature = optionsKey(options);
    await this.diskCache?.ensure(signature);
    const generation = this.screenshots.generation;
    const allPaths = new Set(this.screenshots.entries.map((entry) => entry.path));
    const groups = new Map<string, PendingPattern[]>();

    for (const pattern of patterns) {
      const cached = this.getCached(patternSignature(pattern), signature) ?? {
        matches: [],
        evaluated: {},
      };
      const matches = cached.matches.filter((match) => allPaths.has(match.path));
      const evaluated: Record<string, string> = {};
      for (const [filePath, key] of Object.entries(cached.evaluated)) {
        if (allPaths.has(filePath)) evaluated[filePath] = key;
      }

      const candidates = this.candidatesFor(pattern, options);
      const candidatePaths = new Set(candidates.map((entry) => entry.path));
      const pending = new Map<string, ScreenshotEntry>();
      for (const entry of candidates) {
        const key = screenshotKey(entry);
        if (evaluated[entry.path] === key) continue;
        const existingIndex = matches.findIndex((match) => match.path === entry.path);
        if (existingIndex >= 0) matches.splice(existingIndex, 1);
        pending.set(entry.path, entry);
      }

      const state: PendingPattern = {
        pattern,
        matches,
        evaluated,
        candidates,
        candidatePaths,
        pending,
      };
      if (matches.length >= options.maxMatchesPerPattern) {
        for (const entry of pending.values()) evaluated[entry.path] = screenshotKey(entry);
        pending.clear();
      }

      if (pending.size === 0) {
        result.set(
          pattern.id,
          matches.filter((match) => candidatePaths.has(match.path)),
        );
        this.setCached(patternSignature(pattern), signature, {
          matches,
          evaluated,
        });
        continue;
      }

      const key = `${resolutionKey(pattern)}|${pattern.kind === 'find' ? 'find' : 'detect'}`;
      const group = groups.get(key);
      if (group) group.push(state);
      else groups.set(key, [state]);
    }

    for (const group of groups.values()) {
      const candidates = new Map<string, ScreenshotEntry>();
      for (const state of group) {
        for (const entry of state.pending.values()) candidates.set(entry.path, entry);
      }
      if (candidates.size === 0) continue;

      const active = new Map(group.map((state) => [state.pattern.id, state]));
      let nextIndex = 0;
      let processed = 0;
      const allCandidates = Array.from(candidates.values());
      // 后台按批处理时只取前 N 张尚未评估的新图，剩余留给下一批。
      const list =
        maxNewImages > 0 ? allCandidates.slice(0, maxNewImages) : allCandidates;
      const total = list.length;

      const worker = async (): Promise<void> => {
        while (true) {
          if (active.size === 0) break;
          const index = nextIndex++;
          if (index >= list.length) break;
          const entry = list[index];
          let image;
          try {
            image = await decodeImageFile(entry.path);
          } catch (error) {
            this.onError(`读取截图失败：${entry.path}（${String(error)}）`);
            continue;
          }
          if (
            image.width !== group[0].pattern.resolution.width ||
            image.height !== group[0].pattern.resolution.height
          ) {
            continue;
          }

          let handled = 0;
          for (const [id, state] of active) {
            if (!state.pending.has(entry.path)) continue;
            const match =
              state.pattern.kind === 'find'
                ? matchFind(
                    image,
                    state.pattern,
                    state.pattern.similarity ?? options.findColorSimilarity,
                    options.findColorOffset,
                  )
                : matchDetect(image, state.pattern, options.colorSimilarity);
            state.evaluated[entry.path] = screenshotKey(entry);
            state.pending.delete(entry.path);
            if (match) {
              state.matches.push({
                path: entry.path,
                width: image.width,
                height: image.height,
                anchor: match.anchor,
                points: match.points,
              });
            }
            if (state.matches.length >= options.maxMatchesPerPattern) {
              // 已达上限，剩余图片不需要再逐像素搜索。
              for (const rest of state.pending.values()) {
                state.evaluated[rest.path] = screenshotKey(rest);
              }
              state.pending.clear();
              active.delete(id);
            }
            handled++;
            if (yieldToUi && handled % 32 === 0) {
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
          }

          processed++;
          onProgress?.(processed, total);
          if (yieldToUi) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
      };

      const concurrency = Math.min(8, list.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (generation !== this.screenshots.generation) return result;

      for (const state of group) {
        state.matches = state.matches.filter((match) => allPaths.has(match.path));
        result.set(
          state.pattern.id,
          state.matches.filter((match) => state.candidatePaths.has(match.path)),
        );
        this.setCached(patternSignature(state.pattern), signature, {
          matches: state.matches,
          evaluated: state.evaluated,
        });
      }
    }

    return result;
  }

  private candidatesFor(
    pattern: PatternDefinition,
    options: MatcherOptions,
  ): ScreenshotEntry[] {
    const candidates = this.screenshots.candidates(
      pattern.resolution.width,
      pattern.resolution.height,
    );
    if (pattern.kind === 'find' && options.findColorScanLimit) {
      return candidates.slice(0, options.findColorScanLimit);
    }
    return candidates;
  }

  private getCached(patternKey: string, optionsSignature: string): PatternCacheEntry | undefined {
    const cached = this.cache.get(patternKey);
    if (cached && cached.optionsKey === optionsSignature) {
      return {
        matches: [...cached.entry.matches],
        evaluated: { ...cached.entry.evaluated },
      };
    }
    const disk = this.diskCache?.get(patternKey);
    if (!disk) return undefined;
    return {
      matches: [...disk.matches],
      evaluated: { ...disk.evaluated },
    };
  }

  private setCached(
    patternKey: string,
    optionsSignature: string,
    entry: PatternCacheEntry,
  ): void {
    this.cache.set(patternKey, { optionsKey: optionsSignature, entry });
    this.diskCache?.set(patternKey, entry);
    if (this.cache.size > 2000) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest) this.cache.delete(oldest);
    }
  }

  invalidate(): void {
    this.cache.clear();
    this.diskCache?.reset();
  }

  async flushCache(): Promise<void> {
    await this.diskCache?.flush();
  }

  makeMatchSet(
    stateKey: string,
    label: string,
    pattern: PatternDefinition,
    matches: ScreenshotMatch[],
  ): MatchSet {
    return {
      stateKey,
      label,
      resolution: pattern.resolution,
      points: pattern.points,
      matches,
    };
  }
}
