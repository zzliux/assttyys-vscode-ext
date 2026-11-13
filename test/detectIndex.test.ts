import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DetectPatternIndex } from '../src/core/detectIndex';
import { extractPatterns } from '../src/core/extract';

const REFS = path.resolve('.refs/assttyys_autojs/src/common');

describe('DetectPatternIndex', () => {
  it('getAll 保留同一 key 下的所有 desc 分组', () => {
    const filePath = path.join(REFS, 'multiFindColors.ts');
    const result = extractPatterns(filePath, 1, fs.readFileSync(filePath, 'utf8'));
    const index = new DetectPatternIndex('find');
    index.update(filePath, result.patterns);

    expect(result.patterns.length).toBe(234);
    // 索引按 key 去重后只有 140 个，但后台预匹配必须拿到全部 234 个分组。
    expect(index.size).toBe(140);
    expect(index.getAll()).toHaveLength(234);
  });
});
