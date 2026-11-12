import type { ColorPoint, FindRegion, PatternDefinition, Resolution } from './model';
import {
  colorChannels,
  mapPoint,
  mapRegion,
  pointMatchesAt,
  pointTolerance,
} from './color';
import { RedIndex } from './redIndex';

export interface DecodedImage {
  path: string;
  width: number;
  height: number;
  /** RGBA，每像素 4 字节。 */
  data: Uint8Array;
  redIndex?: RedIndex;
}

export interface ImageMatch {
  anchor: { x: number; y: number };
  points: Array<{ x: number; y: number }>;
}

function sameResolution(a: Resolution, b: Resolution): boolean {
  return a.width === b.width && a.height === b.height;
}

/** 多点比色，所有点都满足才算命中。 */
export function matchDetect(
  image: DecodedImage,
  pattern: PatternDefinition,
  similarity: number,
): ImageMatch | null {
  if (!sameResolution(pattern.resolution, image)) return null;
  if (pattern.points.length === 0) return null;

  const actual = { width: image.width, height: image.height };
  const mappedPoints: Array<{ x: number; y: number }> = [];

  for (const point of pattern.points) {
    const mapped = mapPoint(point.mode, point.x, point.y, pattern.resolution, actual);
    mappedPoints.push(mapped);
    const target = colorChannels(point.color);
    const tolerance = pointTolerance(point, similarity);
    let matched = pointMatchesAt(
      image.data,
      image.width,
      image.height,
      mapped.x,
      mapped.y,
      target,
      tolerance,
      false,
    );
    if (point.resultFlag === 1) matched = !matched;
    if (!matched) return null;
  }

  return { anchor: mappedPoints[0], points: mappedPoints };
}

function ensureRedIndex(image: DecodedImage): RedIndex {
  if (!image.redIndex) {
    image.redIndex = new RedIndex(image.data, image.width, image.height);
  }
  return image.redIndex;
}

function normalizeRegion(
  region: FindRegion | undefined,
  pattern: PatternDefinition,
  actual: Resolution,
): { x1: number; y1: number; x2: number; y2: number } {
  if (!region) {
    return { x1: 0, y1: 0, x2: actual.width - 1, y2: actual.height - 1 };
  }
  const mapped = mapRegion(region, actual);
  return {
    x1: Math.max(0, Math.min(actual.width - 1, Math.min(mapped.x1, mapped.x2))),
    y1: Math.max(0, Math.min(actual.height - 1, Math.min(mapped.y1, mapped.y2))),
    x2: Math.max(0, Math.min(actual.width - 1, Math.max(mapped.x1, mapped.x2))),
    y2: Math.max(0, Math.min(actual.height - 1, Math.max(mapped.y1, mapped.y2))),
  };
}

/**
 * 多点找色。第一个点是锚点，其余点相对锚点偏移；找到后返回锚点。
 *
 * `useOffset` 对应脚本运行时的错位匹配：除锚点外的每个点允许在 3×3 邻域内
 * 命中。默认开启，和 `FindMultiColor(..., true)` 一致。
 */
export function matchFind(
  image: DecodedImage,
  pattern: PatternDefinition,
  similarity: number,
  useOffset: boolean,
): ImageMatch | null {
  if (!sameResolution(pattern.resolution, image)) return null;
  if (pattern.points.length === 0) return null;

  const actual = { width: image.width, height: image.height };
  const mappedPoints = pattern.points.map((point) =>
    mapPoint(point.mode, point.x, point.y, pattern.resolution, actual),
  );
  const anchor = mappedPoints[0];
  const offsets = mappedPoints.map((point) => ({
    x: point.x - anchor.x,
    y: point.y - anchor.y,
  }));
  const region = normalizeRegion(pattern.region, pattern, actual);
  if (region.x1 > region.x2 || region.y1 > region.y2) return null;

  const anchorColor = colorChannels(pattern.points[0].color);
  const anchorTolerance = pointTolerance(pattern.points[0], similarity);
  const anchorRMin = Math.max(0, anchorColor.r - anchorTolerance.r);
  const anchorRMax = Math.min(255, anchorColor.r + anchorTolerance.r);
  const redIndex = ensureRedIndex(image);

  // 把除锚点外的点的颜色/容差/偏移提前算好，避免在候选像素循环里反复计算。
  const preparedPoints = pattern.points.slice(1).map((point, index) => ({
    dx: offsets[index + 1].x,
    dy: offsets[index + 1].y,
    target: colorChannels(point.color),
    tolerance: pointTolerance(point, similarity),
    resultFlag: point.resultFlag,
  }));

  for (let r = anchorRMin; r <= anchorRMax; r++) {
    const start = redIndex.starts[r];
    const end = redIndex.starts[r + 1];
    for (let i = start; i < end; i++) {
      const pos = redIndex.positions[i];
      const x = pos % image.width;
      const y = (pos / image.width) | 0;
      if (x < region.x1 || x > region.x2 || y < region.y1 || y > region.y2) continue;

      // 锚点只检查 G/B；R 已经由桶范围保证。
      const pixelIndex = pos * 4;
      if (Math.abs(image.data[pixelIndex + 1] - anchorColor.g) > anchorTolerance.g) continue;
      if (Math.abs(image.data[pixelIndex + 2] - anchorColor.b) > anchorTolerance.b) continue;

      let allMatched = true;
      for (const prepared of preparedPoints) {
        let matched = pointMatchesAt(
          image.data,
          image.width,
          image.height,
          x + prepared.dx,
          y + prepared.dy,
          prepared.target,
          prepared.tolerance,
          useOffset,
        );
        if (prepared.resultFlag === 1) matched = !matched;
        if (!matched) {
          allMatched = false;
          break;
        }
      }

      if (allMatched) {
        return {
          anchor: { x, y },
          points: offsets.map((offset) => ({ x: x + offset.x, y: y + offset.y })),
        };
      }
    }
  }

  return null;
}


