/**
 * 一帧 RGBA 像素。浏览器侧来自 canvas 的 getImageData，离线侧来自 Python 抽帧管线，
 * 两边喂的是同一个结构 —— 算法核心不知道也不关心自己跑在哪。
 */
export interface Frame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 归一化矩形（0..1）。赛事 UI 是按比例缩放的，所以 ROI 必须与分辨率无关。 */
export interface NormRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 归一化矩形 → 像素矩形，并夹到帧内（外扩过的 ROI 在边缘帧上可能越界）。 */
export function resolveRect(rect: NormRect, width: number, height: number): PixelRect {
  const x = Math.max(0, Math.round(rect.x0 * width));
  const y = Math.max(0, Math.round(rect.y0 * height));
  const x1 = Math.min(width, Math.round(rect.x1 * width));
  const y1 = Math.min(height, Math.round(rect.y1 * height));
  return { x, y, w: Math.max(0, x1 - x), h: Math.max(0, y1 - y) };
}

/** 把 ROI 拷成独立的小 Frame。需要多次遍历同一 ROI 时先裁剪更划算。 */
export function cropFrame(frame: Frame, rect: PixelRect): Frame {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let row = 0; row < rect.h; row++) {
    const src = ((rect.y + row) * frame.width + rect.x) * 4;
    out.set(frame.data.subarray(src, src + rect.w * 4), row * rect.w * 4);
  }
  return { data: out, width: rect.w, height: rect.h };
}
