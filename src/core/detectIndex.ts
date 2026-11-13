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

  constructor(private readonly kind: 'detect' | 'find' = 'detect') {}

  update(filePath: string, patterns: PatternDefinition[]): void {
    const dir = path.dirname(path.resolve(filePath));
    const map = new Map<string, PatternDefinition>();
    for (const pattern of patterns) {
      if (pattern.kind !== this.kind || !pattern.key) continue;
      if (!map.has(pattern.key)) map.set(pattern.key, pattern);
    }
    this.byDirectory.set(dir, map);
  }

  remove(filePath: string): void {
    this.byDirectory.delete(path.dirname(path.resolve(filePath)));
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

  clear(): void {
    this.byDirectory.clear();
  }
}
