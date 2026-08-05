import type { Frame, PixelRect } from './frame';
import { inHsvRange, type HsvRange } from './hsv';

/** 二值掩码，1 = 命中。用 Uint8Array 而非 boolean[]，连通域标注要按下标随机访问。 */
export interface Mask {
  bits: Uint8Array;
  width: number;
  height: number;
}

export function maskInRange(frame: Frame, rect: PixelRect, range: HsvRange): Mask {
  const bits = new Uint8Array(rect.w * rect.h);
  const { data, width } = frame;
  for (let row = 0; row < rect.h; row++) {
    let src = ((rect.y + row) * width + rect.x) * 4;
    let dst = row * rect.w;
    for (let col = 0; col < rect.w; col++, src += 4, dst++) {
      if (inHsvRange(data[src], data[src + 1], data[src + 2], range)) bits[dst] = 1;
    }
  }
  return { bits, width: rect.w, height: rect.h };
}

/**
 * 命中像素占 ROI 的比例，不建掩码。
 * 「赛事 UI 是否还有色」「血条填了多少」这类问题只要一个标量，
 * 为它分配一整张掩码是纯浪费 —— 这个函数每帧要在多个 ROI 上跑。
 */
export function fractionInRange(frame: Frame, rect: PixelRect, range: HsvRange): number {
  if (rect.w === 0 || rect.h === 0) return 0;
  const { data, width } = frame;
  let hit = 0;
  for (let row = 0; row < rect.h; row++) {
    let src = ((rect.y + row) * width + rect.x) * 4;
    for (let col = 0; col < rect.w; col++, src += 4) {
      if (inHsvRange(data[src], data[src + 1], data[src + 2], range)) hit++;
    }
  }
  return hit / (rect.w * rect.h);
}
