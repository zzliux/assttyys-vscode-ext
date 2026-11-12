/**
 * 按红色通道分桶的像素索引。
 *
 * 和 ScriptLib 的 RedList 思路一致：先统计每个 R 值有多少像素，再按 R 值
 * 把所有像素位置连续存放。找色时只扫描目标 R 容差范围内的桶，避免逐像素
 * 扫描整张图。
 */
export class RedIndex {
  readonly width: number;
  readonly height: number;
  /** 256 个桶的起始下标，starts[256] 为总数。 */
  readonly starts: Uint32Array;
  /** 每个像素的 y * width + x，按 R 值分桶排列。 */
  readonly positions: Uint32Array;

  constructor(data: Uint8Array, width: number, height: number) {
    this.width = width;
    this.height = height;
    const counts = new Uint32Array(256);
    const pixelCount = width * height;

    for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
      counts[data[p]]++;
    }

    const starts = new Uint32Array(257);
    let total = 0;
    for (let r = 0; r < 256; r++) {
      starts[r] = total;
      total += counts[r];
    }
    starts[256] = total;

    const positions = new Uint32Array(total);
    const cursors = starts.slice(0, 256);
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const r = data[(rowOffset + x) * 4];
        positions[cursors[r]++] = rowOffset + x;
      }
    }

    this.starts = starts;
    this.positions = positions;
  }
}
