import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPatterns } from '../src/core/extract';
import { colorChannels, mapPoint } from '../src/core/color';
import { matchDetect, matchFind, type DecodedImage } from '../src/core/matcher';
import type { ColorPoint, PatternDefinition } from '../src/core/model';

const DETECT_FILE = path.resolve('.refs/assttyys_autojs/src/common/multiDetectColors.ts');
const FIND_FILE = path.resolve('.refs/assttyys_autojs/src/common/multiFindColors.ts');

function loadPatterns(filePath: string) {
  return extractPatterns(filePath, 1, fs.readFileSync(filePath, 'utf8')).patterns;
}

function blankImage(width = 1280, height = 720): DecodedImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { path: 'memory.png', width, height, data };
}

function setPixel(image: DecodedImage, x: number, y: number, color: number): void {
  const index = (y * image.width + x) * 4;
  const { r, g, b } = colorChannels(color);
  image.data[index] = r;
  image.data[index + 1] = g;
  image.data[index + 2] = b;
  image.data[index + 3] = 255;
}

function paintDetect(image: DecodedImage, pattern: PatternDefinition): void {
  for (const point of pattern.points) {
    const mapped = mapPoint(point.mode, point.x, point.y, pattern.resolution, image);
    setPixel(image, mapped.x, mapped.y, point.color);
  }
}

function point(mode: number, x: number, y: number, color: number): ColorPoint {
  return {
    mode,
    x,
    y,
    color,
    toleranceR: 0,
    toleranceG: 0,
    toleranceB: 0,
    resultFlag: 0,
  };
}

describe('matchDetect', () => {
  it('在同分辨率截图上的固定坐标全部命中的比色定义', () => {
    const pattern = loadPatterns(DETECT_FILE).find((item) => item.key === '准备界面_未准备');
    expect(pattern).toBeDefined();
    const image = blankImage();
    paintDetect(image, pattern!);
    const match = matchDetect(image, pattern!, 93);
    expect(match).not.toBeNull();
    expect(match?.points).toHaveLength(5);
  });

  it('任一颜色超出容差则不算命中', () => {
    const pattern = loadPatterns(DETECT_FILE).find((item) => item.key === '准备界面_未准备');
    const image = blankImage();
    paintDetect(image, pattern!);
    const first = pattern!.points[0];
    const mapped = mapPoint(first.mode, first.x, first.y, pattern!.resolution, image);
    setPixel(image, mapped.x, mapped.y, 0x000000);
    expect(matchDetect(image, pattern!, 93)).toBeNull();
  });

  it('相似度 100 时要求颜色完全一致', () => {
    const pattern = loadPatterns(DETECT_FILE).find((item) => item.key === '准备界面_未准备');
    const image = blankImage();
    paintDetect(image, pattern!);
    expect(matchDetect(image, pattern!, 100)).not.toBeNull();

    const first = pattern!.points[0];
    const mapped = mapPoint(first.mode, first.x, first.y, pattern!.resolution, image);
    setPixel(image, mapped.x, mapped.y, first.color ^ 0x010101);
    expect(matchDetect(image, pattern!, 100)).toBeNull();
  });
});

describe('matchFind', () => {
  it('在 region 内搜索多点找色，并支持错位匹配', () => {
    const pattern = loadPatterns(FIND_FILE).find((item) => item.key === '结界_5勋章');
    expect(pattern).toBeDefined();
    const image = blankImage();
    const anchor = { x: 300, y: 300 };
    const mapped = pattern!.points.map((item) =>
      mapPoint(item.mode, item.x, item.y, pattern!.resolution, image),
    );
    const offsets = mapped.map((item) => ({ x: item.x - mapped[0].x, y: item.y - mapped[0].y }));

    // 最后一个点故意偏移 1 像素，用于验证错位匹配。
    for (let i = 0; i < pattern!.points.length; i++) {
      const dx = i === pattern!.points.length - 1 ? 1 : 0;
      setPixel(image, anchor.x + offsets[i].x + dx, anchor.y + offsets[i].y, pattern!.points[i].color);
    }

    const withOffset = matchFind(image, pattern!, 97, true);
    expect(withOffset).not.toBeNull();
    expect(withOffset?.anchor).toEqual(anchor);

    const withoutOffset = matchFind(image, pattern!, 97, false);
    expect(withoutOffset).toBeNull();
  });

  it('锚点在 region 外时不命中', () => {
    const pattern = loadPatterns(FIND_FILE).find((item) => item.key === '结界_5勋章');
    const image = blankImage();
    const outside = { x: 10, y: 10 };
    const mapped = pattern!.points.map((item) =>
      mapPoint(item.mode, item.x, item.y, pattern!.resolution, image),
    );
    const offsets = mapped.map((item) => ({ x: item.x - mapped[0].x, y: item.y - mapped[0].y }));
    pattern!.points.forEach((item, index) => {
      setPixel(image, outside.x + offsets[index].x, outside.y + offsets[index].y, item.color);
    });
    expect(matchFind(image, pattern!, 97, true)).toBeNull();
  });

  it('单点找色可以匹配任意位置', () => {
    const pattern: PatternDefinition = {
      id: 'single',
      kind: 'find',
      uri: 'memory.ts',
      version: 1,
      label: 'single',
      resolution: { width: 1280, height: 720 },
      points: [point(0, 100, 100, 0x112233)],
      region: { mode: 0, devWidth: 1280, devHeight: 720, x1: 0, y1: 0, x2: 1279, y2: 719 },
      anchorOffset: 0,
    };
    const image = blankImage();
    setPixel(image, 500, 400, 0x112233);
    expect(matchFind(image, pattern, 97, false)?.anchor).toEqual({ x: 500, y: 400 });
  });

  it('结果标志位为 1 的点按取反处理', () => {
    const pattern: PatternDefinition = {
      id: 'invert',
      kind: 'detect',
      uri: 'memory.ts',
      version: 1,
      label: 'invert',
      resolution: { width: 1280, height: 720 },
      points: [point(0, 100, 100, 0xffffff), { ...point(0, 200, 200, 0xffffff), resultFlag: 1 }],
      anchorOffset: 0,
    };
    const image = blankImage();
    setPixel(image, 100, 100, 0xffffff);
    // 第二点目标为白色，但截图仍是黑色，取反后应算成功。
    expect(matchDetect(image, pattern, 100)).not.toBeNull();
    setPixel(image, 200, 200, 0xffffff);
    expect(matchDetect(image, pattern, 100)).toBeNull();
  });
});
