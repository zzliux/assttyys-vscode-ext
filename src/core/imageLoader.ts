import fs from 'node:fs/promises';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { DecodedImage } from './matcher';

interface SharpResult {
  data: Uint8Array;
  info: {
    width: number;
    height: number;
    channels: number;
  };
}

interface SharpInstance {
  ensureAlpha(): {
    raw(): {
      toBuffer(options: { resolveWithObject: true }): Promise<SharpResult>;
    };
  };
}

type SharpFactory = (filePath: string) => SharpInstance;

let sharpModule: SharpFactory | null | undefined;
let sharpWarningLogged = false;

/**
 * sharp 是可选的原生解码器：存在时用它把 PNG/JPEG 解码速度提升一个数量级；
 * 不存在或加载失败（例如非 Windows 平台）时自动退回 pngjs / jpeg-js。
 */
function loadSharp(): SharpFactory | null {
  if (sharpModule !== undefined) return sharpModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sharpModule = require('sharp') as SharpFactory;
  } catch (error) {
    sharpModule = null;
    if (!sharpWarningLogged) {
      sharpWarningLogged = true;
      console.warn(`[assttyys] sharp 不可用，使用纯 JS 解码：${String(error)}`);
    }
  }
  return sharpModule;
}

export async function decodeImageFile(filePath: string): Promise<DecodedImage> {
  const extension = path.extname(filePath).toLowerCase();
  const sharp = loadSharp();
  if (sharp) {
    try {
      const result = await sharp(filePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (result.info.channels === 4 && result.data.length === result.info.width * result.info.height * 4) {
        return {
          path: filePath,
          width: result.info.width,
          height: result.info.height,
          data: result.data,
        };
      }
    } catch (error) {
      if (!sharpWarningLogged) {
        sharpWarningLogged = true;
        console.warn(`[assttyys] sharp 解码失败，使用纯 JS 解码：${String(error)}`);
      }
    }
  }

  const buffer = await fs.readFile(filePath);
  if (extension === '.png') {
    const png = PNG.sync.read(buffer);
    return {
      path: filePath,
      width: png.width,
      height: png.height,
      data: png.data,
    };
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
    return {
      path: filePath,
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
    };
  }
  throw new Error(`不支持的图片格式：${extension}`);
}


