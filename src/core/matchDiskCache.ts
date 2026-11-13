import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScreenshotMatch } from './model';

export interface PatternCacheEntry {
  matches: ScreenshotMatch[];
  /** 已评估过的截图：path -> mtime|size|宽x高。 */
  evaluated: Record<string, string>;
}

interface CacheFile {
  version: 2;
  optionsKey: string;
  entries: Record<string, PatternCacheEntry>;
}

const MAX_ENTRIES = 5000;

/**
 * 把“desc 签名 -> 匹配截图”持久化到扩展的 globalStorage。
 *
 * 缓存不绑定整批截图的指纹，而是按 pattern 记录已经评估过哪些截图；
 * 新增截图只补匹配新图，删除/修改截图只丢掉对应结果。
 */
export class MatchDiskCache {
  private data: CacheFile | null = null;
  private loadedFor = '';
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> | undefined;
  private dirty = false;

  constructor(private readonly filePath: string) {}

  async ensure(optionsKey: string): Promise<void> {
    if (this.data && this.loadedFor === optionsKey) return;
    this.loadedFor = optionsKey;

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CacheFile>;
      if (
        parsed.version === 2 &&
        parsed.optionsKey === optionsKey &&
        parsed.entries &&
        typeof parsed.entries === 'object'
      ) {
        this.data = {
          version: 2,
          optionsKey,
          entries: parsed.entries,
        };
        return;
      }
    } catch {
      // 文件不存在、损坏或版本不匹配时从空缓存开始。
    }

    this.data = { version: 2, optionsKey, entries: {} };
  }

  get(patternKey: string): PatternCacheEntry | undefined {
    return this.data?.entries[patternKey];
  }

  set(patternKey: string, entry: PatternCacheEntry): void {
    if (!this.data) return;
    this.data.entries[patternKey] = entry;
    const keys = Object.keys(this.data.entries);
    if (keys.length > MAX_ENTRIES) {
      for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) {
        delete this.data.entries[key];
      }
    }
    this.dirty = true;
    this.scheduleWrite();
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    if (this.writing) await this.writing;
    await this.writeNow();
  }

  reset(): void {
    this.data = null;
    this.loadedFor = '';
    this.dirty = false;
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    // 增量缓存可能包含大量已评估截图，降低写盘频率，避免后台每批都
    // 重新序列化整份缓存。
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.writeNow();
    }, 3000);
  }

  private async writeNow(): Promise<void> {
    if (!this.dirty || !this.data) return;
    if (this.writing) {
      await this.writing;
      if (!this.dirty) return;
    }
    const payload = JSON.stringify(this.data);
    const target = this.filePath;
    const temporary = `${target}.tmp`;
    this.dirty = false;
    this.writing = (async () => {
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(temporary, payload, 'utf8');
        await fs.rm(target, { force: true });
        await fs.rename(temporary, target);
      } catch (error) {
        console.warn(`[assttyys] 写入匹配缓存失败：${String(error)}`);
      } finally {
        this.writing = undefined;
      }
    })();
    await this.writing;
  }
}
