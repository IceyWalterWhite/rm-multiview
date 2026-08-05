import {
  BLUE_BASE_HP,
  BLUE_OUTPOST_HP,
  DRONE_MINIMAP,
  HP_TEXT,
  MINIMAP,
  RED_BASE_HP,
  RED_OUTPOST_HP,
  TOP_SCOREBOARD,
} from '../rmui/layout';
import { resolveRect, type NormRect, type PixelRect } from '../vision/frame';
import type { StreamKind } from './types';

/**
 * 一路要抓哪几块像素。
 *
 * 只抓真正被读的那几块。整帧 1152×648 是 2.99 MB，这七块加起来不到 6% ——
 * 但**便宜的不是像素数，是读回次数**（见 {@link mergeReadRects}）。
 */
export function roisFor(kind: StreamKind): NormRect[] {
  if (kind === 'drone') {
    // 空中路没有血条也没有记分板：小地图是另一块，记分板那块只用来判「是不是被
    // 全亮画面盖住了」（那块 ROI 落在 FPV 画面本身，见 streamPhase.dronePhase）
    return [DRONE_MINIMAP, TOP_SCOREBOARD];
  }
  return [
    MINIMAP, // 自机位置与朝向
    HP_TEXT, // 自机血量
    TOP_SCOREBOARD, // 逐路自判 + 阵亡判定
    RED_OUTPOST_HP, // 以下四块是全场共享的战略目标血量，十路各读各的再融合
    RED_BASE_HP,
    BLUE_BASE_HP,
    BLUE_OUTPOST_HP,
  ];
}

function union(a: PixelRect, b: PixelRect): PixelRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x1 - x, h: y1 - y };
}
const area = (r: PixelRect) => r.w * r.h;

/**
 * 把邻近的 ROI 并成更少、更大的读回矩形。
 *
 * `getImageData` 的开销由**调用次数**主导而不是像素数：每次调用都要把 GPU 上的纹理
 * 同步读回主存，这个同步点本身就是代价。实测十路整帧 drawImage 一次 + 逐 ROI 读回是
 * 36.7 ms，而逐 ROI 各画各读是 171 ms —— 差的正是多出来的那些提交与同步。
 *
 * 顺着这条道理再往前一步：地面路那七块里，记分板与四块目标血量全挤在画面顶部一条带上，
 * 并成一块就把七次读回压到三次。合并的代价是多读了些用不着的像素，所以用 maxWaste
 * 卡住：并起来的面积超过两块原面积之和的 maxWaste 倍就不并 —— 宁可多读一次，
 * 也不要为了凑数把小地图和记分板并成大半张画面。
 */
export function mergeReadRects(rects: readonly PixelRect[], maxWaste = 2): PixelRect[] {
  const out = rects.filter((r) => r.w > 0 && r.h > 0).map((r) => ({ ...r }));
  for (;;) {
    let best = -1;
    let bestI = -1;
    let bestJ = -1;
    let bestRect: PixelRect | null = null;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const u = union(out[i], out[j]);
        const sum = area(out[i]) + area(out[j]);
        if (area(u) > sum * maxWaste) continue;
        // 优先并浪费最少的那一对，保证结果与输入次序无关
        const waste = area(u) - sum;
        if (bestRect === null || waste < best) {
          best = waste;
          bestI = i;
          bestJ = j;
          bestRect = u;
        }
      }
    }
    if (!bestRect) return out;
    out.splice(bestJ, 1);
    out.splice(bestI, 1);
    out.push(bestRect);
  }
}

/** 一路在某个分辨率下实际要读的矩形。 */
export function readRectsFor(kind: StreamKind, width: number, height: number): PixelRect[] {
  return mergeReadRects(roisFor(kind).map((r) => resolveRect(r, width, height)));
}
