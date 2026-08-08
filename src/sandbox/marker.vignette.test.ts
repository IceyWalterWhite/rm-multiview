import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { detectSelfMarker, detectSelfMarkerResilient } from './marker';
import { fixture, loadFixtures, type FixtureFrame } from './__fixtures__/load';
import { barSaturationFromFrame } from '../matchstate/observe';
import { resolveRect, type Frame } from '../vision/frame';
import { rgbToHsv } from '../vision/hsv';
import {
  DRONE_MARKER_MIN_AREA_RATIO,
  DRONE_MINIMAP,
  HUD_PRESENT_BAR_SAT,
  MINIMAP,
  SELF_MARKER_MIN_AREA_RATIO,
} from '../rmui/layout';

/**
 * 受击红晕的兜底检测。
 *
 * 红晕在像素上就是一层红色半透明叠加：`r' = r(1-α) + Rα`，而 g、b 只是同乘 `(1-α)`。
 * 这里的 α 与 R 不是编出来的 —— 由现网红方英雄的基线帧与红晕帧反解：
 *     基线 (73,174,134) → 红晕 (108,128,93)
 *     1-α = 128/174 = 0.736  →  α = 0.264
 *     73×0.736 + R×0.264 = 108  →  R = 205
 * 用同一组常数合成，就能在不依赖外部夹具的前提下复现「主窗丢检」这一步。
 */

const BASE = { r: 73, g: 174, b: 134 };
const OVERLAY_R = 205;
/** 中等红晕：色相/饱和度掉出主窗但仍在兜底窗内。 */
const ALPHA_MID = 0.2;
/** 现网那三帧最重的一档，由基线与红晕帧直接反解得到。 */
const ALPHA_STRONG = 0.264;

const W = 1152;
const H = 648;
const DISC_RADIUS = 7;

function blankFrame(): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width: W, height: H };
}

/** 在小地图 ROI 正中画一个自机圆盘。返回它在 ROI 内的归一化坐标。 */
function paintDisc(frame: Frame, colour: { r: number; g: number; b: number }) {
  const rect = resolveRect(MINIMAP, W, H);
  const cx = rect.x + (rect.w >> 1);
  const cy = rect.y + (rect.h >> 1);
  for (let dy = -DISC_RADIUS; dy <= DISC_RADIUS; dy++) {
    for (let dx = -DISC_RADIUS; dx <= DISC_RADIUS; dx++) {
      if (dx * dx + dy * dy > DISC_RADIUS * DISC_RADIUS) continue;
      const i = ((cy + dy) * W + cx + dx) * 4;
      frame.data[i] = colour.r;
      frame.data[i + 1] = colour.g;
      frame.data[i + 2] = colour.b;
    }
  }
  return { x: ((rect.w >> 1) + 0.5) / rect.w, y: ((rect.h >> 1) + 0.5) / rect.h };
}

const vignette = (c: { r: number; g: number; b: number }, alpha: number) => ({
  r: Math.round(c.r * (1 - alpha) + OVERLAY_R * alpha),
  g: Math.round(c.g * (1 - alpha)),
  b: Math.round(c.b * (1 - alpha)),
});

describe('受击红晕下的自机标记', () => {
  it('叠加模型把色相与饱和度一起往下压', () => {
    const base = rgbToHsv(BASE.r, BASE.g, BASE.b);
    const mid = rgbToHsv(...(Object.values(vignette(BASE, ALPHA_MID)) as [number, number, number]));
    const strong = rgbToHsv(...(Object.values(vignette(BASE, ALPHA_STRONG)) as [number, number, number]));
    // 单调下降是这套修法成立的前提：若某一项反而升高，说明模型选错了。
    expect(base.h).toBeGreaterThan(mid.h);
    expect(mid.h).toBeGreaterThan(strong.h);
    expect(base.s).toBeGreaterThan(mid.s);
    expect(mid.s).toBeGreaterThan(strong.s);
    // 最重那一档要落回现网实测的区间（色相 31~59、饱和度 55~78），
    // 否则这条测试测的就不是真实的损伤模式。
    expect(strong.h).toBeGreaterThanOrEqual(31);
    expect(strong.h).toBeLessThanOrEqual(59);
    expect(strong.s).toBeGreaterThanOrEqual(55);
    expect(strong.s).toBeLessThanOrEqual(78);
  });

  it('中等红晕：主窗交白卷，兜底窗收回来且位置一致', () => {
    const clean = blankFrame();
    const at = paintDisc(clean, BASE);
    const healthy = detectSelfMarker(clean);
    expect(healthy, '基线圆盘应当能被主窗检出').not.toBeNull();
    expect(healthy!.x).toBeCloseTo(at.x, 2);
    expect(healthy!.y).toBeCloseTo(at.y, 2);

    const hurt = blankFrame();
    paintDisc(hurt, vignette(BASE, ALPHA_MID));
    expect(detectSelfMarker(hurt), '红晕把色相与饱和度一起压出主窗').toBeNull();

    const rescued = detectSelfMarkerResilient(hurt);
    expect(rescued, '兜底窗应当收回这一帧').not.toBeNull();
    // 位置必须与未受伤时一致 —— 兜底的意义是接着定位，不是给个大概。
    expect(rescued!.x).toBeCloseTo(healthy!.x, 2);
    expect(rescued!.y).toBeCloseTo(healthy!.y, 2);
  });

  it('强红晕仍然丢检 —— 这是当前修法的上界，不是回归', () => {
    // 纯色圆盘比真实标记更难：真标记有梯度，中位像素掉出窗时更绿的那一半还能凑出
    // 连通域。所以现网强红晕帧并非全丢（红方英雄 17 帧从 10 收到 12），
    // 但按实测中位色 h=31~59 合成的均质圆盘，两个窗都够不着。
    // 要继续往下收就得动 hMin，而 45 以下会撞上能量机关的黄绿（h≈42）。
    const hurt = blankFrame();
    paintDisc(hurt, vignette(BASE, ALPHA_STRONG));
    expect(detectSelfMarker(hurt)).toBeNull();
    expect(detectSelfMarkerResilient(hurt)).toBeNull();
  });

  it('兜底只增不减，且不把位置拽走（浏览器现网 420 帧）', () => {
    const BROWSER = 'D:/rmcap/browsercap';
    if (!existsSync(`${BROWSER}/frames.json`)) return; // 像素不进仓库，没生成就跳过
    const isDrone = (f: FixtureFrame) => f.stream.includes('空中');
    const hudOn = (f: FixtureFrame) => barSaturationFromFrame(f.frame, f.side) >= HUD_PRESENT_BAR_SAT;
    const roiOf = (f: FixtureFrame) =>
      isDrone(f)
        ? ([DRONE_MINIMAP, DRONE_MARKER_MIN_AREA_RATIO] as const)
        : ([MINIMAP, SELF_MARKER_MIN_AREA_RATIO] as const);

    const frames = loadFixtures(BROWSER).filter((f) => isDrone(f) || hudOn(f));
    let moved = 0;
    const tally = { 地面: { n: 0, plain: 0, resilient: 0 }, 空中: { n: 0, plain: 0, resilient: 0 } };
    // 位移按路分组统计：检出率会骗人，锁没锁住同一个目标只有位移看得出来
    // （DRONE_MARKER_MIN_AREA_RATIO 当年正是靠这条识破「满 ROI 乱跳的杂色」）。
    const shifts = { 地面: { plain: [] as number[], resilient: [] as number[] }, 空中: { plain: [] as number[], resilient: [] as number[] } };
    const prev = new Map<string, { t: number; plain: ReturnType<typeof detectSelfMarker>; resilient: ReturnType<typeof detectSelfMarker> }>();

    for (const f of [...frames].sort((a, b) => a.stream.localeCompare(b.stream) || a.t - b.t)) {
      const [roi, ratio] = roiOf(f);
      const kind = isDrone(f) ? '空中' : '地面';
      const rect = resolveRect(roi, f.frame.width, f.frame.height);
      const a = detectSelfMarker(f.frame, roi, ratio);
      const b = detectSelfMarkerResilient(f.frame, roi, ratio);
      tally[kind].n++;
      if (a) tally[kind].plain++;
      if (b) tally[kind].resilient++;
      // 主窗给得出答案时，兜底必须原样透传 —— 这是两遍检测零回归的全部依据。
      if (a && (!b || a.x !== b.x || a.y !== b.y || a.area !== b.area)) moved++;

      const last = prev.get(f.stream);
      if (last && f.t - last.t === 1) {
        if (last.plain && a) shifts[kind].plain.push(Math.hypot((a.x - last.plain.x) * rect.w, (a.y - last.plain.y) * rect.h));
        if (last.resilient && b) shifts[kind].resilient.push(Math.hypot((b.x - last.resilient.x) * rect.w, (b.y - last.resilient.y) * rect.h));
      }
      prev.set(f.stream, { t: f.t, plain: a, resilient: b });
    }

    const med = (xs: number[]) => (xs.length ? xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)] : NaN);
    for (const kind of ['地面', '空中'] as const) {
      const t = tally[kind];
      console.log(
        `[红晕兜底] ${kind} ${t.n} 帧：检出 ${t.plain} → ${t.resilient}   ` +
          `连续帧位移中位 ${med(shifts[kind].plain).toFixed(2)} → ${med(shifts[kind].resilient).toFixed(2)}px ` +
          `(n=${shifts[kind].plain.length}→${shifts[kind].resilient.length})`,
      );
    }
    expect(moved, '主窗命中的帧不得被兜底改写').toBe(0);
    expect(tally.地面.resilient).toBeGreaterThanOrEqual(tally.地面.plain);
    expect(tally.空中.resilient).toBeGreaterThanOrEqual(tally.空中.plain);
  }, 600_000);

  it('主窗能检出时兜底不介入，结果逐位等同', () => {
    // 蓝方图标贴身那个构图：放宽窗会把两团并合、质心偏 0.0066，
    // 两遍检测的全部意义就是让这种帧走不到第二遍。
    const f = fixture('B1Hero', 1400).frame;
    const plain = detectSelfMarker(f)!;
    const resilient = detectSelfMarkerResilient(f)!;
    expect(resilient).toEqual(plain);
    expect(resilient.x).toBeCloseTo(0.6045, 3);
  });
});
