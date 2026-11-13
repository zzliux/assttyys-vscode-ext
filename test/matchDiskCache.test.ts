import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MatchDiskCache } from '../src/core/matchDiskCache';
import type { ScreenshotMatch } from '../src/core/model';

const testDir = path.resolve('test-output', `match-cache-${process.pid}`);
const cachePath = path.join(testDir, 'cache.json');

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('MatchDiskCache', () => {
  it('按参数持久化 pattern 结果和已评估截图', async () => {
    const cache = new MatchDiskCache(cachePath);
    await cache.ensure('options-a');
    const matches: ScreenshotMatch[] = [
      {
        path: 'C:/shots/a.png',
        width: 1280,
        height: 720,
        anchor: { x: 10, y: 20 },
        points: [{ x: 10, y: 20 }],
      },
    ];
    cache.set('pattern-a', {
      matches,
      evaluated: { 'C:/shots/a.png': '100|200|1280x720' },
    });
    await cache.flush();

    const reopened = new MatchDiskCache(cachePath);
    await reopened.ensure('options-a');
    expect(reopened.get('pattern-a')).toEqual({
      matches,
      evaluated: { 'C:/shots/a.png': '100|200|1280x720' },
    });

    await reopened.ensure('options-b');
    expect(reopened.get('pattern-a')).toBeUndefined();
  });
});
