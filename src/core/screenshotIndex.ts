import fg from 'fast-glob';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface ScreenshotEntry {
  path: string;
  mtimeMs: number;
  size: number;
  width: number;
  height: number;
}

export interface ScreenshotScanOptions {
  includeSubfolders: boolean;
  extensions: string[];
  workspaceFolders: string[];
  cwd: string;
}

export interface ScreenshotScanResult {
  entries: ScreenshotEntry[];
  errors: string[];
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

function hasGlobMagic(value: string): boolean {
  return /[*?[\]{}()!]/.test(value);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function expandEnvironment(value: string): string {
  let result = value.replace(/\$\{env:([^}]+)\}/g, (_match, name: string) => process.env[name] ?? '');
  if (result === '~' || result.startsWith('~/') || result.startsWith('~\\')) {
    result = path.join(os.homedir(), result.slice(1));
  }
  return result;
}

function extensionGlob(extensions: string[], recursive: boolean): string {
  const normalized = Array.from(
    new Set(
      extensions
        .map((extension) => extension.replace(/^\./, '').toLowerCase())
        .filter((extension) => IMAGE_EXTENSIONS.has(`.${extension}`)),
    ),
  );
  if (normalized.length === 0) normalized.push('png', 'jpg', 'jpeg');
  const pattern = normalized.length === 1 ? `*.${normalized[0]}` : `*.{${normalized.join(',')}}`;
  return recursive ? `**/${pattern}` : pattern;
}

function normalizeExtensions(extensions: string[]): string[] {
  return Array.from(
    new Set(
      extensions
        .map((extension) => extension.trim().toLowerCase())
        .map((extension) => (extension.startsWith('.') ? extension.slice(1) : extension))
        .filter(Boolean),
    ),
  );
}

async function expandPathVariants(rawValue: string, workspaceFolders: string[]): Promise<string[]> {
  const cleaned = expandEnvironment(stripQuotes(rawValue));
  if (!cleaned) return [];

  const hasWorkspaceToken = cleaned.includes('${workspaceFolder}');
  const bases = workspaceFolders.length > 0 ? workspaceFolders : [process.cwd()];
  if (hasWorkspaceToken) {
    return bases.map((base) => cleaned.replace(/\$\{workspaceFolder\}/g, base));
  }
  return [cleaned];
}

async function collectFromPath(
  rawPath: string,
  options: ScreenshotScanOptions,
  errors: string[],
): Promise<string[]> {
  const variants = await expandPathVariants(rawPath, options.workspaceFolders);
  const results = new Set<string>();

  for (const variant of variants) {
    if (!variant) continue;
    if (!hasGlobMagic(variant)) {
      const absolute = path.isAbsolute(variant) ? variant : path.resolve(options.cwd, variant);
      let stat;
      try {
        stat = await fs.stat(absolute);
      } catch {
        errors.push(`路径不存在：${variant}`);
        continue;
      }
      if (stat.isFile()) {
        results.add(path.resolve(absolute));
        continue;
      }
      if (stat.isDirectory()) {
        const pattern = extensionGlob(options.extensions, options.includeSubfolders);
        try {
          const files = await fg(pattern, {
            cwd: absolute,
            absolute: true,
            onlyFiles: true,
            followSymbolicLinks: true,
            dot: false,
            suppressErrors: true,
            ignore: ['**/node_modules/**', '**/.git/**'],
          });
          files.forEach((file) => results.add(path.resolve(file)));
        } catch (error) {
          errors.push(`扫描目录失败：${absolute}（${String(error)}）`);
        }
      }
      continue;
    }

    const pattern = variant.replace(/\\/g, '/');
    if (path.isAbsolute(pattern)) {
      try {
        const files = await fg(pattern, {
          absolute: true,
          onlyFiles: true,
          followSymbolicLinks: true,
          dot: false,
          suppressErrors: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });
        files.forEach((file) => results.add(path.resolve(file)));
      } catch (error) {
        errors.push(`glob 扫描失败：${variant}（${String(error)}）`);
      }
      continue;
    }

    for (const base of options.workspaceFolders.length > 0 ? options.workspaceFolders : [options.cwd]) {
      try {
        const files = await fg(pattern, {
          cwd: base,
          absolute: true,
          onlyFiles: true,
          followSymbolicLinks: true,
          dot: false,
          suppressErrors: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });
        files.forEach((file) => results.add(path.resolve(file)));
      } catch (error) {
        errors.push(`glob 扫描失败：${variant}（${String(error)}）`);
      }
    }
  }

  return Array.from(results);
}

function readPngSize(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24) return undefined;
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return undefined;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegSize(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    let marker = buffer[offset + 1];
    while (marker === 0xff && offset + 2 < buffer.length) {
      offset++;
      marker = buffer[offset + 1];
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) return undefined;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return undefined;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (offset + 9 > buffer.length) return undefined;
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}

async function readImageSize(filePath: string): Promise<{ width: number; height: number } | undefined> {
  const extension = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) return undefined;

  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const initialLength = Math.min(stat.size, extension === '.png' ? 64 : 512 * 1024);
    const buffer = Buffer.alloc(initialLength);
    await handle.read(buffer, 0, initialLength, 0);
    if (extension === '.png') return readPngSize(buffer);
    const headerSize = readJpegSize(buffer);
    if (headerSize) return headerSize;
    if (stat.size <= initialLength) return undefined;
    const full = Buffer.alloc(stat.size);
    await handle.read(full, 0, stat.size, 0);
    return readJpegSize(full);
  } finally {
    await handle.close();
  }
}

/**
 * 扫描所有配置的截图路径，读取尺寸并按分辨率分组。
 */
export class ScreenshotIndex {
  entries: ScreenshotEntry[] = [];
  errors: string[] = [];
  generation = 0;
  scannedAt: Date | null = null;
  private readonly byResolution = new Map<string, ScreenshotEntry[]>();

  async rebuild(paths: string[], options: ScreenshotScanOptions): Promise<void> {
    const errors: string[] = [];
    const collected = new Set<string>();

    for (const rawPath of paths) {
      const files = await collectFromPath(rawPath, options, errors);
      files.forEach((file) => collected.add(file));
    }

    const normalizedExtensions = normalizeExtensions(options.extensions);
    const allowedExtensions = new Set(
      normalizedExtensions
        .map((extension) => `.${extension}`)
        .filter((extension) => IMAGE_EXTENSIONS.has(extension)),
    );
    if (allowedExtensions.size === 0) {
      allowedExtensions.add('.png');
      allowedExtensions.add('.jpg');
      allowedExtensions.add('.jpeg');
    }

    const candidates = Array.from(collected).filter((file) =>
      allowedExtensions.has(path.extname(file).toLowerCase()),
    );

    const entries: ScreenshotEntry[] = [];
    const concurrency = 8;
    for (let start = 0; start < candidates.length; start += concurrency) {
      const batch = candidates.slice(start, start + concurrency);
      const results = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const stat = await fs.stat(filePath);
            const size = await readImageSize(filePath);
            if (!size) {
              errors.push(`无法读取图片尺寸：${filePath}`);
              return null;
            }
            return {
              path: filePath,
              mtimeMs: stat.mtimeMs,
              size: stat.size,
              width: size.width,
              height: size.height,
            } satisfies ScreenshotEntry;
          } catch (error) {
            errors.push(`读取截图失败：${filePath}（${String(error)}）`);
            return null;
          }
        }),
      );
      for (const result of results) if (result) entries.push(result);
    }

    entries.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
    this.entries = entries;
    this.errors = errors;
    this.scannedAt = new Date();
    this.generation++;
    this.byResolution.clear();
    for (const entry of entries) {
      const key = `${entry.width}x${entry.height}`;
      const list = this.byResolution.get(key);
      if (list) list.push(entry);
      else this.byResolution.set(key, [entry]);
    }
  }

  candidates(width: number, height: number): ScreenshotEntry[] {
    return this.byResolution.get(`${width}x${height}`) ?? [];
  }

  get resolutionSummary(): string {
    const parts: string[] = [];
    for (const [key, list] of this.byResolution) {
      parts.push(`${key}×${list.length}`);
    }
    return parts.join('，');
  }

  clear(): void {
    this.entries = [];
    this.byResolution.clear();
    this.errors = [];
    this.generation++;
  }
}
