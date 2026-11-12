import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { ScreenshotIndex } from '../src/core/screenshotIndex';
import { decodeImageFile } from '../src/core/imageLoader';

const OUTPUT_ROOT = path.resolve('test-output');

async function writePng(filePath: string, width: number, height: number): Promise<void> {
  const png = new PNG({ width, height });
  png.data.fill(0);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  await fs.writeFile(filePath, PNG.sync.write(png));
}

async function writeJpeg(filePath: string, width: number, height: number): Promise<void> {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const encoded = jpeg.encode({ data, width, height }, 90);
  await fs.writeFile(filePath, encoded.data);
}

describe('ScreenshotIndex', () => {
  const testDir = path.join(OUTPUT_ROOT, `screenshot-index-${process.pid}`);

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('递归扫描图片、读取尺寸并按分辨率分组', async () => {
    await fs.mkdir(path.join(testDir, 'nested'), { recursive: true });
    await writePng(path.join(testDir, 'a.png'), 1280, 720);
    await writePng(path.join(testDir, 'nested', 'b.png'), 640, 360);
    await writeJpeg(path.join(testDir, 'nested', 'c.jpg'), 1280, 720);
    await fs.writeFile(path.join(testDir, 'not-image.txt'), 'hello');

    const index = new ScreenshotIndex();
    await index.rebuild([testDir], {
      includeSubfolders: true,
      extensions: ['png', 'jpg', 'jpeg'],
      workspaceFolders: [],
      cwd: testDir,
    });

    expect(index.entries).toHaveLength(3);
    expect(index.candidates(1280, 720)).toHaveLength(2);
    expect(index.candidates(640, 360)).toHaveLength(1);
    expect(index.candidates(1920, 1080)).toHaveLength(0);
    expect(index.resolutionSummary).toContain('1280x720');

    const decoded = await decodeImageFile(path.join(testDir, 'a.png'));
    expect(decoded.width).toBe(1280);
    expect(decoded.height).toBe(720);
    expect(decoded.data.length).toBe(1280 * 720 * 4);

    const decodedJpeg = await decodeImageFile(path.join(testDir, 'nested', 'c.jpg'));
    expect(decodedJpeg.width).toBe(1280);
    expect(decodedJpeg.height).toBe(720);
  });

  it('支持 glob 路径且不重复', async () => {
    const index = new ScreenshotIndex();
    await index.rebuild([path.join(testDir, '**/*.png').replace(/\\/g, '/')], {
      includeSubfolders: true,
      extensions: ['png'],
      workspaceFolders: [],
      cwd: testDir,
    });
    expect(index.entries).toHaveLength(2);
  });

  it('目录不存在时记录错误但不抛异常', async () => {
    const index = new ScreenshotIndex();
    await index.rebuild([path.join(testDir, 'missing')], {
      includeSubfolders: true,
      extensions: ['png'],
      workspaceFolders: [],
      cwd: testDir,
    });
    expect(index.entries).toHaveLength(0);
    expect(index.errors.length).toBeGreaterThan(0);
  });
});
