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
  it('按截图指纹和参数持久化并复用匹配结果', async () => {
    const cache = new MatchDiskCache(cachePath);
    await cache.ensure('fingerprint-a', 'options-a');
    const matches: ScreenshotMatch[] = [
      {
        path: 'C:/shots/a.png',
        width: 1280,
        height: 720,
        anchor: { x: 10, y: 20 },
        points: [{ x: 10, y: 20 }],
      },
    ];
    cache.set('pattern-a', matches);
    await cache.flush();

    const current = new MatchDiskCache(cachePath);
    expect(await current.isCurrent('fingerprint-a', 'options-a')).toBe(true);
    expect(await current.isCurrent('fingerprint-b', 'options-a')).toBe(false);
    expect(await current.isCurrent('fingerprint-a', 'options-b')).toBe(false);

    const reopened = new MatchDiskCache(cachePath);
    await reopened.ensure('fingerprint-a', 'options-a');
    expect(reopened.get('pattern-a')).toEqual(matches);

    await reopened.ensure('fingerprint-b', 'options-a');
    expect(reopened.get('pattern-a')).toBeUndefined();

    await reopened.ensure('fingerprint-a', 'options-b');
    expect(reopened.get('pattern-a')).toBeUndefined();
  });
});
