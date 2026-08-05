import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { detectSelfMarker } from './marker';
import { loadFixtures } from './__fixtures__/load';
import { DRONE_MARKER_MIN_AREA_RATIO, DRONE_MINIMAP, SELF_MARKER_MIN_AREA_RATIO } from '../rmui/layout';

/**
 * 空中机器人位置检出评估（现网 1920×1080，只取该路真正在播 FPV 的帧）。
 *
 * 这一组存在的理由是红蓝两方的自机图标压根不是同一种颜色：蓝方是饱和的绿（落进
 * SELF_MARKER_GREEN 的有 141px），红方叠了一层红色阵营底色、机身被压成发白，
 * 只剩箭头还绿，落进区间的仅 26px —— 恰好卡在地面那个面积门限（45px）之下，
 * 整个红方无人机被静默滤掉。修法是给空中单独一条更低的门限，见 layout.ts 的扫描表。
 *
 * 判据用**连续帧位移**而不是检出率：门限太高时红方也有 1.2% 的"检出"，
 * 但那些位移中位 53px，是满 ROI 乱跳的杂色；门限降下来后位移中位 1.9px，
 * 才说明锁住的是同一个目标。检出率单独看会把噪声读成信号。
 *
 * 等待卡帧已在抽取阶段剔除 —— 那些帧本就没有小地图，算进分母会把结论稀释成
 * 一个毫无意义的百分比（这个坑在 480p 那轮踩过一次）。
 *
 * 像素不进仓库（169MB）。没生成时整组跳过，而不是假装通过。
 */
const DIR = 'D:/rmcap/evaldrone';
const available = existsSync(`${DIR}/frames.json`);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);

interface Shot {
  t: number;
  x: number;
  y: number;
}

/** 跑一遍某个门限，返回检出序列。位移用 ROI 像素表达，便于和扫描表对照。 */
function sweep(stream: string, ratio: number): { hit: number; n: number; medianJump: number } {
  const frames = loadFixtures(DIR).filter((f) => f.stream === stream);
  const shots: Shot[] = [];
  for (const f of frames) {
    const m = detectSelfMarker(f.frame, DRONE_MINIMAP, ratio);
    if (m) shots.push({ t: f.t, x: m.x, y: m.y });
  }
  const jumps: number[] = [];
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].t - shots[i - 1].t > 3) continue; // 隔太久的两次检出之间没有连续性可言
    jumps.push(Math.hypot(shots[i].x - shots[i - 1].x, shots[i].y - shots[i - 1].y) * 268);
  }
  jumps.sort((a, b) => a - b);
  return { hit: shots.length, n: frames.length, medianJump: jumps[jumps.length >> 1] ?? Infinity };
}

describe.skipIf(!available)('空中机器人位置检出', () => {
  it('空中门限救回红方无人机，且不动摇蓝方', () => {
    const rows: string[] = [];
    for (const stream of ['R空中机器人', 'B空中机器人']) {
      const before = sweep(stream, SELF_MARKER_MIN_AREA_RATIO);
      const after = sweep(stream, DRONE_MARKER_MIN_AREA_RATIO);
      rows.push(
        `${stream} (n=${after.n}): 地面门限 ${pct(before.hit, before.n)}% ` +
          `(位移中位 ${before.medianJump.toFixed(1)}px) → 空中门限 ${pct(after.hit, after.n)}% ` +
          `(位移中位 ${after.medianJump.toFixed(1)}px)`,
      );
      // 位移是真伪的判据：锁住同一个目标时它该是个位数像素
      expect(after.medianJump).toBeLessThan(15);
    }
    console.log('\n[空中机器人]\n' + rows.join('\n'));

    const red = sweep('R空中机器人', DRONE_MARKER_MIN_AREA_RATIO);
    const blue = sweep('B空中机器人', DRONE_MARKER_MIN_AREA_RATIO);
    expect(pct(red.hit, red.n)).toBeGreaterThan(70); // 修复前是 1.2%
    expect(pct(blue.hit, blue.n)).toBeGreaterThan(85); // 蓝方本来就好，不许被拖累
  }, 60_000);
});
