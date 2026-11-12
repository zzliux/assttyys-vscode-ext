import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPatterns } from '../src/core/extract';
import { DetectPatternIndex } from '../src/core/detectIndex';

const REFS = path.resolve('.refs/assttyys_autojs/src/common');

function parse(relativePath: string) {
  const filePath = path.join(REFS, relativePath);
  return extractPatterns(filePath, 1, fs.readFileSync(filePath, 'utf8'));
}

describe('extractPatterns', () => {
  it('解析 multiDetectColors.ts 的比色定义', () => {
    const result = parse('multiDetectColors.ts');
    expect(result.patterns.length).toBeGreaterThan(60);
    expect(result.references).toHaveLength(0);

    const pattern = result.patterns.find((item) => item.key === '准备界面_未准备');
    expect(pattern).toBeDefined();
    expect(pattern?.kind).toBe('detect');
    expect(pattern?.resolution).toEqual({ width: 1280, height: 720 });
    expect(pattern?.points.length).toBe(5);
    expect(pattern?.points[0]).toMatchObject({
      mode: 2,
      x: 1240,
      y: 702,
      color: 0xcead83,
      resultFlag: 0,
    });
    expect(result.patterns.every((item) => item.resolution.width === 1280)).toBe(true);
    expect(result.patterns.every((item) => item.resolution.height === 720)).toBe(true);
    expect(result.patterns.every((item) => item.key && item.label === item.key)).toBe(true);
  });

  it('解析 multiFindColors.ts 的找色定义及 region/similar', () => {
    const result = parse('multiFindColors.ts');
    expect(result.patterns.length).toBeGreaterThan(100);
    expect(result.references).toHaveLength(0);

    const pattern = result.patterns.find((item) => item.key === '结界_5勋章');
    expect(pattern).toBeDefined();
    expect(pattern?.kind).toBe('find');
    expect(pattern?.label).toBe('结界_5勋章');
    expect(pattern?.region).toMatchObject({
      mode: 1,
      devWidth: 1280,
      devHeight: 720,
      x1: 124,
      y1: 125,
      x2: 1152,
      y2: 545,
    });

    const styled = result.patterns.find((item) => item.key === '剧情问号');
    expect(styled?.similarity).toBe(93);
    expect(result.patterns.every((item) => item.region)).toBe(true);
  });

  it('解析功能文件里的内联 desc 数组和字符串引用', () => {
    const result = parse('funcList/001_准备.ts');
    expect(result.patterns).toHaveLength(3);
    expect(result.patterns.map((item) => item.label)).toEqual([
      'Func001.operator[2]',
      'Func001.operator[3]',
      'Func001.operator[4]',
    ]);
    expect(result.references.map((item) => item.key)).toEqual([
      '准备界面_未准备',
      '战斗界面_手动状态',
    ]);
  });

  it('忽略 config 里的普通字符串 desc', () => {
    const result = parse('funcList/012_寮突破_翻页.ts');
    expect(result.patterns).toHaveLength(0);
    expect(result.references).toHaveLength(1);
    expect(result.references[0].key).toBe('突破界面_寮');
  });

  it('字符串引用可以按目录解析到比色定义', () => {
    const detectFile = path.join(REFS, 'multiDetectColors.ts');
    const detect = extractPatterns(detectFile, 1, fs.readFileSync(detectFile, 'utf8'));
    const index = new DetectPatternIndex();
    index.update(detectFile, detect.patterns);
    expect(index.size).toBeGreaterThan(60);

    const funcFile = path.join(REFS, 'funcList/001_准备.ts');
    const target = index.resolve(funcFile, '准备界面_未准备');
    expect(target?.resolution).toEqual({ width: 1280, height: 720 });
  });
});
