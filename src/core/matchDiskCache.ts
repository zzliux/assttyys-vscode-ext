import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScreenshotMatch } from './model';

interface CacheFile {
  version: 1;
  fingerprint: string;
  optionsKey: string;
  entries: Record<string, ScreenshotMatch[]>;
}

const MAX_ENTRIES = 5000;

/**
 * 把“desc 签名 -> 匹配截图”持久化到扩展的 globalStorage。
 *
 * 截图集合（fingerprint）或匹配参数变化时整个缓存作废；同一个 desc 只改
 * 注释/排版时签名不变，重启 VS Code 后也能直接复用。
 */
export class MatchDiskCache {
  private data: CacheFile | null = null;
  private loadedFor = '';
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> | undefined;
  private dirty = false;

  constructor(private readonly filePath: string) {}

  async ensure(fingerprint: string, optionsKey: string): Promise<void> {
    const key = `${fingerprint}\u0000${optionsKey}`;
    if (this.data && this.loadedFor === key) return;
    this.loadedFor = key;

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CacheFile>;
      if (
        parsed.version === 1 &&
        parsed.fingerprint === fingerprint &&
        parsed.optionsKey === optionsKey &&
        parsed.entries &&
        typeof parsed.entries === 'object'
      ) {
        this.data = {
          version: 1,
          fingerprint,
          optionsKey,
          entries: parsed.entries,
        };
        return;
      }
    } catch {
      // 文件不存在、损坏或版本不匹配时从空缓存开始。
    }

    this.data = { version: 1, fingerprint, optionsKey, entries: {} };
  }

  get(patternKey: string): ScreenshotMatch[] | undefined {
    return this.data?.entries[patternKey];
  }

  set(patternKey: string, matches: ScreenshotMatch[]): void {
    if (!this.data) return;
    this.data.entries[patternKey] = matches;
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
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.writeNow();
    }, 800);
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
