import crypto from 'node:crypto';
import type {
  MatchSet,
  MatcherOptions,
  PatternDefinition,
  ScreenshotMatch,
} from './model';
import type { ScreenshotIndex } from './screenshotIndex';
import type { MatchDiskCache } from './matchDiskCache';
import { decodeImageFile } from './imageLoader';
import { matchDetect, matchFind } from './matcher';

export interface MatchCancellation {
  readonly isCancellationRequested: boolean;
}

interface MatchCacheItem {
  generation: number;
  optionsKey: string;
  matches: ScreenshotMatch[];
}

function optionsKey(options: MatcherOptions): string {
  return [
    options.colorSimilarity,
    options.findColorSimilarity,
    options.findColorOffset,
    options.maxMatchesPerPattern,
    options.findColorScanLimit ?? 'all',
  ].join('|');
}

function resolutionKey(pattern: PatternDefinition): string {
  return `${pattern.resolution.width}x${pattern.resolution.height}`;
}

/**
 * 只对“会影响匹配结果”的字段做签名。
 *
 * 文件版本号、行号、key/label 都不参与，所以只改注释、调整排版、甚至改描述
 * 文字时，只要 desc 的坐标/颜色/容差没变，就能命中旧缓存。
 */
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
 * 把定义、截图索引和图片缓存串起来。
 *
 * 大量截图时，按“每张图只解码一次、同时测试多个 desc”的方式匹配，避免
 * 每个 desc 都重新扫描/解码所有截图。
 */
export class MatcherService {
  private readonly cache = new Map<string, MatchCacheItem>();
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
   * 批量匹配：同一分辨率的截图只解码一次，对每张图依次测试所有未完成的
   * pattern。已经命中 maxMatchesPerPattern 的 pattern 会提前退出。
   */
  async matchPatternsBatch(
    patterns: PatternDefinition[],
    options: MatcherOptions,
    token?: MatchCancellation,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, ScreenshotMatch[]>> {
    const result = new Map<string, ScreenshotMatch[]>();
    const signature = optionsKey(options);
    const pendingById = new Map<string, PatternDefinition>();
    if (token?.isCancellationRequested) return result;
    await this.diskCache?.ensure(this.screenshots.currentFingerprint, signature);

    for (const pattern of patterns) {
      if (pendingById.has(pattern.id)) continue;
      const cached = this.getCached(patternSignature(pattern), signature);
      if (cached) {
        result.set(pattern.id, cached);
      } else {
        pendingById.set(pattern.id, pattern);
      }
    }
    if (pendingById.size === 0) return result;

    const groups = new Map<string, PatternDefinition[]>();
    for (const pattern of pendingById.values()) {
      const key = `${resolutionKey(pattern)}|${pattern.kind === 'find' ? 'find' : 'detect'}`;
      const group = groups.get(key);
      if (group) group.push(pattern);
      else groups.set(key, [pattern]);
    }

    for (const group of groups.values()) {
      const first = group[0];
      let candidates = this.screenshots.candidates(
        first.resolution.width,
        first.resolution.height,
      );
      if (first.kind === 'find' && options.findColorScanLimit) {
        candidates = candidates.slice(0, options.findColorScanLimit);
      }
      const partial = new Map<string, ScreenshotMatch[]>();
      for (const pattern of group) partial.set(pattern.id, []);

      if (candidates.length === 0) {
        for (const pattern of group) {
          result.set(pattern.id, []);
          this.setCached(patternSignature(pattern), signature, []);
        }
        continue;
      }

      const active = new Map<string, PatternDefinition>(
        group.map((pattern) => [pattern.id, pattern]),
      );
      let nextIndex = 0;
      let processed = 0;
      const total = candidates.length;

      const worker = async (): Promise<void> => {
        // 批量匹配一旦开始就做完并写缓存。VS Code 在滚动时会取消旧的 hint
        // 请求，如果这里中途放弃，下一次滚动又要重新解码全部截图。
        while (true) {
          if (active.size === 0) break;
          const index = nextIndex++;
          if (index >= candidates.length) break;
          const entry = candidates[index];
          let image;
          try {
            image = await decodeImageFile(entry.path);
          } catch (error) {
            this.onError(`读取截图失败：${entry.path}（${String(error)}）`);
            continue;
          }
          if (
            image.width !== first.resolution.width ||
            image.height !== first.resolution.height
          ) {
            continue;
          }

          for (const [id, pattern] of active) {
            if (partial.get(id)!.length >= options.maxMatchesPerPattern) {
              active.delete(id);
              continue;
            }
            const match =
              pattern.kind === 'find'
                ? matchFind(
                    image,
                    pattern,
                    pattern.similarity ?? options.findColorSimilarity,
                    options.findColorOffset,
                  )
                : matchDetect(image, pattern, options.colorSimilarity);
            if (!match) continue;
            partial.get(id)!.push({
              path: entry.path,
              width: image.width,
              height: image.height,
              anchor: match.anchor,
              points: match.points,
            });
            if (partial.get(id)!.length >= options.maxMatchesPerPattern) {
              active.delete(id);
            }
          }

          processed++;
          onProgress?.(processed, total);
        }
      };

      const concurrency = Math.min(8, candidates.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      for (const pattern of group) {
        const matches = partial.get(pattern.id) ?? [];
        result.set(pattern.id, matches);
        this.setCached(patternSignature(pattern), signature, matches);
      }
    }

    return result;
  }

  private getCached(
    patternKey: string,
    optionsSignature: string,
  ): ScreenshotMatch[] | undefined {
    const cached = this.cache.get(patternKey);
    if (
      cached &&
      cached.generation === this.screenshots.generation &&
      cached.optionsKey === optionsSignature
    ) {
      return cached.matches;
    }
    return this.diskCache?.get(patternKey);
  }

  private setCached(
    patternKey: string,
    optionsSignature: string,
    matches: ScreenshotMatch[],
  ): void {
    this.cache.set(patternKey, {
      generation: this.screenshots.generation,
      optionsKey: optionsSignature,
      matches,
    });
    this.diskCache?.set(patternKey, matches);
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
