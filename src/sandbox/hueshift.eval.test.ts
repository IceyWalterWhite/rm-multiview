import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { detectSelfMarker } from './marker';
import { loadFixtures, type FixtureFrame } from './__fixtures__/load';
import { barSaturationFromFrame } from '../matchstate/observe';
import { rgbToHsv, type HsvRange } from '../vision/hsv';
import { resolveRect } from '../vision/frame';
import { findBlobs } from '../vision/blob';
import { maskInRange } from '../vision/mask';
import { HUD_PRESENT_BAR_SAT, MINIMAP, SELF_MARKER_GREEN, SELF_MARKER_MIN_AREA_RATIO } from '../rmui/layout';

/**
 * 色相窗上沿扫描 —— 判定「浏览器像素检出率偏低」到底是色彩链路还是场景差异。
 *
 * 浏览器与 ffmpeg 解出来的自机绿相差 +4（色相中位 80 vs 76，OpenCV 0..179 尺度），
 * 而 SELF_MARKER_GREEN 的上沿是 86，是在 ffmpeg 像素上标的。若这 4 的偏移真的在
 * 咬掉像素，那么把上沿往外放，浏览器那组的检出率应当**陡升**；若是场景差异
 * （两组本就是不同场次、不同地图、不同遮挡），放宽上沿应当**几乎不动**。
 *
 * 这是个自对照实验：同一份数据、同一套代码，只动一个数。跨数据集比绝对检出率
 * 说明不了任何问题 —— 两组录的根本不是同一场比赛。
 *
 * 判据同时看位移中位：放宽色彩窗迟早会把别的绿收进来，那时检出率还在涨，
 * 但位移会炸 —— 抓的是满 ROI 乱跳的杂色而不是自机。
 */
const DIRS: [string, string][] = [
  ['浏览器', 'D:/rmcap/browsercap'],
  ['ffmpeg', 'D:/rmcap/eval540'],
  // 随仓库提交的夹具：源 mp4 明确标了 bt709，ffmpeg 会照标签解 —— 与浏览器同一个约定。
  // 阈值当初就是在它上面标的，所以它是判定「到底谁偏了」的第三方基准。
  ['committed', 'src/sandbox/__fixtures__'],
];
const present = DIRS.filter(([, d]) => existsSync(`${d}/frames.json`));

const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);
const isDrone = (f: FixtureFrame) => f.stream.includes('空中');
const hudOn = (f: FixtureFrame) => barSaturationFromFrame(f.frame, f.side) >= HUD_PRESENT_BAR_SAT;

/** 小地图 ROI 的归一化坐标 → 像素距离，位移才好和扫描表对照。 */
const ROI_PX = 400;

function sweep(frames: FixtureFrame[], range: HsvRange) {
  const byStream = new Map<string, { t: number; x: number; y: number }[]>();
  let hit = 0;
  let multi = 0;
  for (const f of frames) {
    // 多候选率：当初定这个窗口时用的就是它（见 layout.ts 的标定表）。
    // 放宽色相上沿最怕的不是漏检，是把蓝方图标收进来 —— 那会稳定地误检成自机，
    // 位移中位反而很漂亮，只有候选数会露馅。
    const rect = resolveRect(MINIMAP, f.frame.width, f.frame.height);
    const minArea = Math.max(4, Math.round(SELF_MARKER_MIN_AREA_RATIO * rect.w * rect.h));
    if (findBlobs(maskInRange(f.frame, rect, range), minArea).blobs.length > 1) multi++;

    const m = detectSelfMarker(f.frame, MINIMAP, SELF_MARKER_MIN_AREA_RATIO, range);
    if (!m) continue;
    hit++;
    const arr = byStream.get(f.stream) ?? [];
    arr.push({ t: f.t, x: m.x, y: m.y });
    byStream.set(f.stream, arr);
  }
  const jumps: number[] = [];
  for (const shots of byStream.values()) {
    shots.sort((a, b) => a.t - b.t);
    for (let i = 1; i < shots.length; i++) {
      if (shots[i].t - shots[i - 1].t > 2) continue;
      jumps.push(Math.hypot(shots[i].x - shots[i - 1].x, shots[i].y - shots[i - 1].y) * ROI_PX);
    }
  }
  jumps.sort((a, b) => a - b);
  return { hit, multi, n: frames.length, medianJump: jumps[jumps.length >> 1] ?? NaN };
}

describe.skipIf(present.length === 0)('色相窗上沿扫描', () => {
  it('放宽上沿：浏览器那组该陡升，ffmpeg 那组该基本不动', () => {
    const H_MAX = [86, 88, 90, 92, 95, 100];
    const lines: string[] = [];
    const gain: Record<string, number> = {};

    for (const [label, dir] of present) {
      const ground = loadFixtures(dir).filter((f) => !isDrone(f) && hudOn(f));
      const row = H_MAX.map((hMax) => {
        const r = sweep(ground, { ...SELF_MARKER_GREEN, hMax });
        return { hMax, pct: pct(r.hit, r.n), jump: r.medianJump, multi: pct(r.multi, r.n) };
      });
      gain[label] = row[row.length - 1].pct - row[0].pct;
      lines.push(
        `  ${label}（n=${ground.length}）\n` +
          row
            .map(
              (r) =>
                `    hMax=${String(r.hMax).padEnd(3)} 检出 ${String(r.pct).padStart(5)}%  ` +
                `多候选 ${String(r.multi).padStart(5)}%  位移中位 ${r.jump.toFixed(1)}px`,
            )
            .join('\n'),
      );
    }
    console.log('\n[色相窗上沿扫描]\n' + lines.join('\n'));

    // 只有两组都在时才谈对照
    if (present.length === 2) {
      console.log(`\n  放宽 86→100 的检出增益：浏览器 +${gain['浏览器'].toFixed(1)} / ffmpeg +${gain['ffmpeg'].toFixed(1)}`);
    }
    expect(present.length).toBeGreaterThan(0);
  }, 600_000);

  /**
   * 色相直方图 —— 放宽上沿之前必须先看清楚自机绿与蓝方青之间还剩多少空隙。
   *
   * 小地图上同时画着自机（绿）和友方/敌方图标（青），两簇在色相轴上相邻。
   * 窗口上沿放到两簇之间的谷底才安全；越过谷底就会把别的机器人当成自机，
   * 那是比漏检严重得多的错误 —— 漏检只是没数据，误检是把假坐标当真的画上沙盘。
   */
  it('自机绿与蓝方青之间的谷底在哪', () => {
    const BINS = 30; // 55..115，每档 2
    const lines: string[] = [];
    for (const [label, dir] of present) {
      const frames = loadFixtures(dir).filter((f) => !isDrone(f) && hudOn(f));
      const hist = new Array(BINS).fill(0);
      for (const f of frames) {
        const r = resolveRect(MINIMAP, f.frame.width, f.frame.height);
        for (let y = 0; y < r.h; y++) {
          let i = ((r.y + y) * f.frame.width + r.x) * 4;
          for (let x = 0; x < r.w; x++, i += 4) {
            const c = rgbToHsv(f.frame.data[i], f.frame.data[i + 1], f.frame.data[i + 2]);
            if (c.s < SELF_MARKER_GREEN.sMin || c.v < SELF_MARKER_GREEN.vMin) continue;
            const bin = Math.floor((c.h - 55) / 2);
            if (bin >= 0 && bin < BINS) hist[bin]++;
          }
        }
      }
      const max = Math.max(...hist, 1);
      lines.push(
        `  ${label}（n=${frames.length} 帧）` +
          hist
            .map((v, i) => `\n    H ${String(55 + i * 2).padStart(3)}..${String(57 + i * 2).padStart(3)} ` +
              '#'.repeat(Math.round((40 * v) / max)) + (v ? ` ${v}` : ''))
            .join(''),
      );
    }
    console.log('\n[小地图色相直方图，S/V 已过门限]\n' + lines.join('\n'));
    expect(present.length).toBeGreaterThan(0);
  }, 600_000);
});
