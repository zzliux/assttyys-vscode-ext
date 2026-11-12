import type { ColorPoint, FindRegion, Resolution } from './model';

/** 四舍六入五成双，和 ScriptLib 的 Round 保持一致。 */
export function roundHalfEven(num: number): number {
  const fractionalPart = num % 1;
  const integerPart = Math.floor(num);
  if (Math.abs(fractionalPart) === 0.5) {
    return integerPart % 2 === 0 ? integerPart : integerPart + 1;
  }
  return Math.round(num);
}

export function colorChannels(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

/**
 * 相似度百分比转成每个通道允许的最大差值。
 * 93% -> 18，97% -> 8。
 */
export function similarityTolerance(similarity: number): number {
  return roundHalfEven(255 - 255 * (similarity / 100));
}

/**
 * 把开发分辨率坐标换算到截图分辨率。
 *
 * 本插件只匹配同分辨率的截图，因此实际是恒等变换；保留完整公式是为了
 * 和 AnchorGraphicHelper.GetPoint 的行为一致。
 */
export function mapPoint(
  mode: number,
  x: number,
  y: number,
  dev: Resolution,
  actual: Resolution,
): { x: number; y: number } {
  const scaleX = actual.width / dev.width;
  const scaleY = actual.height / dev.height;
  const centerX = roundHalfEven(actual.width / 2) - 1;
  const centerY = roundHalfEven(actual.height / 2) - 1;
  let outX: number;
  let outY: number;

  if (mode === 0 || mode === -1) {
    outX = roundHalfEven(x * scaleX);
    outY = roundHalfEven(y * scaleY);
  } else if (mode === 1) {
    outX = roundHalfEven(centerX - (dev.width / 2 - x - 1) * scaleX);
    outY = roundHalfEven(y * scaleY);
  } else if (mode === 2) {
    outX = roundHalfEven(actual.width - 1 - (dev.width - x - 1) * scaleX);
    outY = roundHalfEven(y * scaleY);
  } else if (mode === 3) {
    outX = roundHalfEven(x * scaleX);
    outY = roundHalfEven(y * scaleY);
  } else if (mode === 4) {
    outX = roundHalfEven(x * scaleX);
    outY = roundHalfEven(centerY - (dev.height / 2 - y - 1) * scaleY);
  } else if (mode === 5) {
    outX = roundHalfEven(x * scaleX);
    outY = roundHalfEven(actual.height - 1 - (dev.height - y - 1) * scaleY);
  } else {
    outX = roundHalfEven(x * scaleX);
    outY = roundHalfEven(y * scaleY);
  }

  return { x: outX, y: outY };
}

/** 把找色区域换算到截图分辨率。 */
export function mapRegion(
  region: FindRegion,
  actual: Resolution,
): { x1: number; y1: number; x2: number; y2: number } {
  const dev = { width: region.devWidth, height: region.devHeight };
  const start = mapPoint(region.mode, region.x1, region.y1, dev, actual);
  const end = mapPoint(region.mode, region.x2, region.y2, dev, actual);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

export function pointTolerance(
  point: ColorPoint,
  similarity: number,
): { r: number; g: number; b: number } {
  const base = similarityTolerance(similarity);
  return {
    r: Math.min(255, base + point.toleranceR),
    g: Math.min(255, base + point.toleranceG),
    b: Math.min(255, base + point.toleranceB),
  };
}

/** 读取一个像素，越界返回 null。 */
export function pixelAt(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): { r: number; g: number; b: number } | null {
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const i = (y * width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

/**
 * 直接比对某个绝对坐标及其 3×3 邻域。
 * 这里的 tolerance 是目标颜色 + 允许差值，单独传入。
 */
export function pointMatchesAt(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  target: { r: number; g: number; b: number },
  tolerance: { r: number; g: number; b: number },
  useOffset: boolean,
): boolean {
  const count = useOffset ? 9 : 1;
  for (let index = 0; index < count; index++) {
    const offset = OFFSETS[index];
    const px = x + offset[0];
    const py = y + offset[1];
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const i = (py * width + px) * 4;
    if (
      Math.abs(data[i] - target.r) <= tolerance.r &&
      Math.abs(data[i + 1] - target.g) <= tolerance.g &&
      Math.abs(data[i + 2] - target.b) <= tolerance.b
    ) {
      return true;
    }
  }
  return false;
}
