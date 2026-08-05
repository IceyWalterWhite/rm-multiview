import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { detectSelfMarker } from './marker';
import { readHp } from './hp';
import { readObjectives } from './objectives';
import { loadFixtures, type FixtureFrame } from './__fixtures__/load';
import { barSaturationFromFrame } from '../matchstate/observe';
import { rgbToHsv } from '../vision/hsv';
import { resolveRect } from '../vision/frame';
import {
  MINIMAP,
  DRONE_MINIMAP,
  HUD_PRESENT_BAR_SAT,
  SELF_MARKER_GREEN,
  SELF_MARKER_MIN_AREA_RATIO,
  DRONE_MARKER_MIN_AREA_RATIO,
} from '../rmui/layout';

/**
 * 浏览器取像素的端到端验收。
 *
 * 与 live.eval 的区别只有一处，但那一处是全部意义所在：像素来自**现网页面的
 * canvas.getImageData**，而不是 ffmpeg 解码。检测代码、ROI 常量、阈值全都不变。
 *
 * 要证的不是识别准不准 —— 那在 live.eval 上已经量过了。要证的是**浏览器与 ffmpeg
 * 的 YUV→RGB 转换是否一致**：两者若用了不同的色彩矩阵（BT.601 vs BT.709），
 * 同一帧解出来的 RGB 就会整体偏移，标定在 ffmpeg 像素上的 HSV 阈值会全线失准。
 * 这种偏差不会让程序报错，只会让检出率悄悄掉一截，所以必须显式对照。
 *
 * 判据是与离线 540p 那组的**同指标对照**，不是绝对门槛 —— 两边看的是同一个赛事、
 * 同一种清晰度、同一套 ROI，指标该在同一量级；差一大截就说明色彩链路有问题。
 *
 * 像素不进仓库。没生成时整组跳过，而不是假装通过。
 */
const DIR = 'D:/rmcap/browsercap';
const REF = 'D:/rmcap/eval540'; // ffmpeg 抽的同清晰度参照组
const available = existsSync(`${DIR}/frames.json`);

const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);
const isDrone = (f: FixtureFrame) => f.stream.includes('空中');
const hudOn = (f: FixtureFrame) => barSaturationFromFrame(f.frame, f.side) >= HUD_PRESENT_BAR_SAT;
const detect = (f: FixtureFrame) =>
  isDrone(f)
    ? detectSelfMarker(f.frame, DRONE_MINIMAP, DRONE_MARKER_MIN_AREA_RATIO)
    : detectSelfMarker(f.frame, MINIMAP, SELF_MARKER_MIN_AREA_RATIO);

/** 落在自机绿区间内的像素的色相/饱和度/明度分位。色彩矩阵不同的话这三条会整体平移。 */
function markerHsv(frames: FixtureFrame[]): { n: number; h: number[]; s: number[]; v: number[] } {
  const hs: number[] = [];
  const ss: number[] = [];
  const vs: number[] = [];
  for (const f of frames) {
    const roi = isDrone(f) ? DRONE_MINIMAP : MINIMAP;
    const r = resolveRect(roi, f.frame.width, f.frame.height);
    for (let y = 0; y < r.h; y++) {
      let i = ((r.y + y) * f.frame.width + r.x) * 4;
      for (let x = 0; x < r.w; x++, i += 4) {
        const c = rgbToHsv(f.frame.data[i], f.frame.data[i + 1], f.frame.data[i + 2]);
        if (c.h < SELF_MARKER_GREEN.hMin || c.h > SELF_MARKER_GREEN.hMax) continue;
        if (c.s < SELF_MARKER_GREEN.sMin || c.v < SELF_MARKER_GREEN.vMin) continue;
        hs.push(c.h);
        ss.push(c.s);
        vs.push(c.v);
      }
    }
  }
  const q = (a: number[]) => {
    a.sort((x, y) => x - y);
    return [10, 50, 90].map((p) => a[Math.floor((a.length * p) / 100)] ?? NaN);
  };
  return { n: hs.length, h: q(hs), s: q(ss), v: q(vs) };
}

function rates(frames: FixtureFrame[]) {
  const ground = frames.filter((f) => !isDrone(f) && hudOn(f));
  const drones = frames.filter((f) => isDrone(f));
  const posHit = ground.filter((f) => detect(f)).length;
  const withHeading = ground.map(detect).filter((m) => m && m.heading !== null).length;
  const hpHit = ground.filter((f) => readHp(f.frame)).length;
  const malformed = ground
    .map((f) => ({ f, hp: readHp(f.frame) }))
    .filter(({ hp }) => hp && hp.current > hp.max)
    .map(({ f, hp }) => `${f.stream}@${f.t} ${hp!.raw}`);

  // 目标血量只取地面路。**空中路没有记分板** —— 实测那四个 ROI 在空中路上整片全黑，
  // 偶尔读出来的数字（35.7%）是 FPV 画面里的东西被当成了字形，纯属捏造，
  // 把它们算进读出率会稀释指标，喂进多路投票更会污染结果。
  const fields = ['redBase', 'redOutpost', 'blueBase', 'blueOutpost'] as const;
  const bucket = new Map<string, number[]>();
  let read = 0;
  let attempted = 0;
  for (const f of ground) {
    const o = readObjectives(f.frame);
    for (const k of fields) {
      attempted++;
      if (!o[k]) continue;
      read++;
      bucket.set(`${k}@${f.t}`, [...(bucket.get(`${k}@${f.t}`) ?? []), o[k]!.value]);
    }
  }
  let agree = 0;
  let total = 0;
  for (const vals of bucket.values()) {
    if (vals.length < 3) continue;
    const counts = new Map<number, number>();
    for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
    agree += Math.max(...counts.values());
    total += vals.length;
  }
  return {
    groundN: ground.length,
    droneN: drones.length,
    pos: pct(posHit, ground.length),
    heading: pct(withHeading, posHit),
    hp: pct(hpHit, ground.length),
    malformed,
    objRead: pct(read, attempted),
    objAgree: pct(agree, total),
    objN: total,
    drone: pct(drones.filter((f) => detect(f)).length, drones.length),
  };
}

describe.skipIf(!available)('浏览器像素端到端', () => {
  it('浏览器 canvas 像素喂进同一套检测代码', () => {
    const browser = rates(loadFixtures(DIR));
    const line = (label: string, r: ReturnType<typeof rates>) =>
      `  ${label.padEnd(10)} 位置 ${r.pos}%  朝向 ${r.heading}%  血量 ${r.hp}%（违例 ${r.malformed.length}）  ` +
      `目标读出 ${r.objRead}% 一致 ${r.objAgree}%(n=${r.objN})  空中 ${r.drone}%  [地面 n=${r.groundN}]`;

    const rows = [line('浏览器', browser)];
    if (existsSync(`${REF}/frames.json`)) rows.push(line('ffmpeg540', rates(loadFixtures(REF))));
    console.log('\n[端到端对照]\n' + rows.join('\n'));

    expect(browser.malformed).toEqual([]);
    expect(browser.groundN).toBeGreaterThan(0);
    // 浏览器像素上识别不该塌掉。离线 540p 是 91.8%/95.5%，留足余量取 80%。
    expect(browser.pos).toBeGreaterThan(80);
    expect(browser.hp).toBeGreaterThan(80);
  }, 180_000);

  it('浏览器与 ffmpeg 的色彩转换一致', () => {
    const b = markerHsv(loadFixtures(DIR).filter((f) => !isDrone(f)));
    console.log(`\n[自机绿像素 HSV 分位 10/50/90]\n  浏览器   n=${b.n}  H=${b.h}  S=${b.s}  V=${b.v}`);
    if (existsSync(`${REF}/frames.json`)) {
      const r = markerHsv(loadFixtures(REF).filter((f) => !isDrone(f)));
      console.log(`  ffmpeg   n=${r.n}  H=${r.h}  S=${r.s}  V=${r.v}`);
      // 色相中位差得离谱就说明两边用了不同的 YUV→RGB 矩阵，阈值必须重标
      expect(Math.abs(b.h[1] - r.h[1])).toBeLessThan(6);
    }
    expect(b.n).toBeGreaterThan(0);
  }, 180_000);
});
