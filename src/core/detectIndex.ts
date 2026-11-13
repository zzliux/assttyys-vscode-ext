import path from 'node:path';
import type { PatternDefinition } from './model';

/**
 * 维护 multiDetectColors.ts 的 key -> 定义索引，供功能文件里的字符串引用解析。
 *
 * 按定义文件所在目录分组，解析引用时选路径前缀最长的那个，避免多个项目
 * 共用同一套 key 时串味。
 */
export class DetectPatternIndex {
  private readonly byDirectory = new Map<string, Map<string, PatternDefinition>>();
  private readonly allByDirectory = new Map<string, PatternDefinition[]>();

  constructor(private readonly kind: 'detect' | 'find' = 'detect') {}

  update(filePath: string, patterns: PatternDefinition[]): void {
    const dir = path.dirname(path.resolve(filePath));
    const map = new Map<string, PatternDefinition>();
    const all: PatternDefinition[] = [];
    for (const pattern of patterns) {
      if (pattern.kind !== this.kind || !pattern.key) continue;
      all.push(pattern);
      if (!map.has(pattern.key)) map.set(pattern.key, pattern);
    }
    this.byDirectory.set(dir, map);
    this.allByDirectory.set(dir, all);
  }

  remove(filePath: string): void {
    const dir = path.dirname(path.resolve(filePath));
    this.byDirectory.delete(dir);
    this.allByDirectory.delete(dir);
  }

  /**
   * 同一个 key 在 multiFindColors 里可能有多个 desc 分组。
   * 导航只需要第一个，但截图图标必须拿到全部，否则会漏掉后面分组的命中。
   */
  resolveAll(fromFile: string, key: string): PatternDefinition[] {
    const source = path.resolve(fromFile);
    let bestDir = '';
    let best: PatternDefinition[] = [];
    for (const [dir, list] of this.allByDirectory) {
      if (!source.startsWith(dir + path.sep) && source !== dir) continue;
      if (dir.length < bestDir.length) continue;
      const matches = list.filter((pattern) => pattern.key === key);
      if (matches.length > 0) {
        bestDir = dir;
        best = matches;
      }
    }
    if (best.length > 0) return best;

    const matches: PatternDefinition[] = [];
    for (const list of this.allByDirectory.values()) {
      for (const pattern of list) {
        if (pattern.key === key) matches.push(pattern);
      }
    }
    return matches;
  }

  resolve(fromFile: string, key: string): PatternDefinition | undefined {
    const source = path.resolve(fromFile);
    let bestDir = '';
    let best: PatternDefinition | undefined;
    for (const [dir, map] of this.byDirectory) {
      if (!source.startsWith(dir + path.sep) && source !== dir) continue;
      if (dir.length < bestDir.length) continue;
      const pattern = map.get(key);
      if (pattern) {
        bestDir = dir;
        best = pattern;
      }
    }
    if (best) return best;

    // 没有路径前缀关系时，退回全局唯一 key。
    const matches: PatternDefinition[] = [];
    for (const map of this.byDirectory.values()) {
      const pattern = map.get(key);
      if (pattern) matches.push(pattern);
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  get size(): number {
    let count = 0;
    for (const map of this.byDirectory.values()) count += map.size;
    return count;
  }

  /** 返回全部 pattern，包括同一个 key 下不同的 desc 分组。 */
  getAll(): PatternDefinition[] {
    const patterns: PatternDefinition[] = [];
    for (const list of this.allByDirectory.values()) {
      patterns.push(...list);
    }
    return patterns;
  }

  clear(): void {
    this.byDirectory.clear();
    this.allByDirectory.clear();
  }
}
