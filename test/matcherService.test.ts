import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { extractPatterns } from '../src/core/extract';
import { colorChannels, mapPoint } from '../src/core/color';
import { ScreenshotIndex } from '../src/core/screenshotIndex';
import { MatcherService } from '../src/core/matcherService';

const DETECT_FILE = path.resolve('.refs/assttyys_autojs/src/common/multiDetectColors.ts');
const OUTPUT_ROOT = path.resolve('test-output');
const testDir = path.join(OUTPUT_ROOT, `matcher-service-${process.pid}`);

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('MatcherService', () => {
  it('从截图目录读取图片并匹配 multiDetectColors 定义', async () => {
    const patterns = extractPatterns(
      DETECT_FILE,
      1,
      await fs.readFile(DETECT_FILE, 'utf8'),
    ).patterns;
    const pattern = patterns.find((item) => item.key === '准备界面_未准备');
    expect(pattern).toBeDefined();

    const png = new PNG({ width: 1280, height: 720 });
    png.data.fill(0);
    for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
    for (const point of pattern!.points) {
      const mapped = mapPoint(point.mode, point.x, point.y, pattern!.resolution, {
        width: 1280,
        height: 720,
      });
      const index = (mapped.y * 1280 + mapped.x) * 4;
      const color = colorChannels(point.color);
      png.data[index] = color.r;
      png.data[index + 1] = color.g;
      png.data[index + 2] = color.b;
    }
    await fs.mkdir(testDir, { recursive: true });
    const imagePath = path.join(testDir, 'match.png');
    await fs.writeFile(imagePath, PNG.sync.write(png));

    const screenshots = new ScreenshotIndex();
    await screenshots.rebuild([testDir], {
      includeSubfolders: true,
      extensions: ['png'],
      workspaceFolders: [],
      cwd: testDir,
    });
    const service = new MatcherService(screenshots);
    const options = {
      colorSimilarity: 93,
      findColorSimilarity: 97,
      findColorOffset: true,
      maxMatchesPerPattern: 10,
    };
    const matches = await service.matchPattern(pattern!, options);

    expect(matches).toHaveLength(1);
    expect(matches[0].path).toBe(imagePath);
    expect(matches[0].width).toBe(1280);
    expect(matches[0].height).toBe(720);

    // 同一个 desc 只改 id/version/行号时，应命中签名缓存，不再解码文件。
    // 删除图片后如果仍返回旧结果，说明缓存生效。
    await fs.rm(imagePath);
    const renamedPattern = {
      ...pattern!,
      id: 'another-id',
      version: 99,
      anchorOffset: 0,
      label: 'another-label',
    };
    const cachedMatches = await service.matchPattern(renamedPattern, options);
    expect(cachedMatches).toHaveLength(1);
    expect(cachedMatches[0].path).toBe(imagePath);
  });
});
