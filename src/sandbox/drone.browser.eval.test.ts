import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { detectSelfMarker } from './marker';
import { loadFixtures, type FixtureFrame } from './__fixtures__/load';
import { resolveRect } from '../vision/frame';
import { findBlobs } from '../vision/blob';
import { maskInRange, fractionInRange } from '../vision/mask';
import { rgbToHsv } from '../vision/hsv';
import {
  DRONE_MARKER_MIN_AREA_RATIO,
  DRONE_MINIMAP,
  SELF_MARKER_GREEN,
  TEAM_BLUE,
  TEAM_RED,
} from '../rmui/layout';

/**
 * 空中检出只有 27.4% —— 先分清「没 HUD」和「有标记但被挡住」。
 *
 * 地面路靠 barSaturationFromFrame 条件化分母（HUD 亮着才算），空中路没有这个开关：
 * **空中机器人没有血量**，那一路根本不存在血条，不是「血条在别的位置」。
 * 所以这里另找一个与血量无关的：**小地图上同时有红有蓝**。这是小地图存在的充分特征 ——
 * 场地图上双方图标常驻，而无人机那一路不放 FPV 时（操作手摄像头/等待卡）不可能同时有。
 *
 * 分完之后再看失败帧里最大绿团的面积分布：
 *   面积 0      → 标记根本不在画面里（HUD 缺席或自机没进小地图）
 *   面积 1..门限 → 标记在，被面积门限挡掉了 —— 那是门限该调
 */
const DIR = 'D:/rmcap/browsercap';
const available = existsSync(`${DIR}/frames.json`);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);

/** 小地图存在的判据：红蓝阵营色都占到一定比例。 */
function minimapPresent(f: FixtureFrame): boolean {
  const r = resolveRect(DRONE_MINIMAP, f.frame.width, f.frame.height);
  return fractionInRange(f.frame, r, TEAM_RED) >= 0.004 && fractionInRange(f.frame, r, TEAM_BLUE) >= 0.004;
}

/** 该帧内最大的一团自机绿有多少像素（不设门限）。 */
function largestGreen(f: FixtureFrame): number {
  const r = resolveRect(DRONE_MINIMAP, f.frame.width, f.frame.height);
  const blobs = findBlobs(maskInRange(f.frame, r, SELF_MARKER_GREEN), 1).blobs;
  return blobs.length ? blobs[0].area : 0;
}

describe.skipIf(!available)('空中检出的分母与门限', () => {
  it('条件化分母后还剩多少漏检，漏在哪', () => {
    const drones = loadFixtures(DIR).filter((f) => f.stream.includes('空中'));
    const rows: string[] = [];
    const missAreas: number[] = [];
    let presentAll = 0;
    let hitAll = 0;

    for (const stream of [...new Set(drones.map((f) => f.stream))].sort()) {
      const fs = drones.filter((f) => f.stream === stream);
      const present = fs.filter(minimapPresent);
      const hit = present.filter((f) => detectSelfMarker(f.frame, DRONE_MINIMAP, DRONE_MARKER_MIN_AREA_RATIO));
      presentAll += present.length;
      hitAll += hit.length;
      for (const f of present) {
        if (!detectSelfMarker(f.frame, DRONE_MINIMAP, DRONE_MARKER_MIN_AREA_RATIO)) missAreas.push(largestGreen(f));
      }
      rows.push(
        `  ${stream.padEnd(14)} n=${String(fs.length).padStart(3)}  ` +
          `有小地图 ${String(pct(present.length, fs.length)).padStart(5)}%  ` +
          `未条件化检出 ${String(pct(fs.filter((f) => detectSelfMarker(f.frame, DRONE_MINIMAP, DRONE_MARKER_MIN_AREA_RATIO)).length, fs.length)).padStart(5)}%  ` +
          `条件化后 ${String(pct(hit.length, present.length)).padStart(5)}%`,
      );
    }

    missAreas.sort((a, b) => a - b);
    const zero = missAreas.filter((a) => a === 0).length;
    const rect = resolveRect(DRONE_MINIMAP, 1152, 648);
    const gate = Math.max(4, Math.round(DRONE_MARKER_MIN_AREA_RATIO * rect.w * rect.h));
    const belowGate = missAreas.filter((a) => a > 0 && a < gate).length;

    console.log(
      '\n[空中检出分解 · 浏览器现网]\n' + rows.join('\n') +
        `\n  合计条件化后 ${pct(hitAll, presentAll)}%（n=${presentAll}）` +
        `\n  面积门限 = ${gate}px（ROI ${rect.w}x${rect.h}）` +
        `\n  漏检帧里最大绿团面积：0px ${zero} 帧 / 1..${gate - 1}px ${belowGate} 帧 / 共 ${missAreas.length} 帧` +
        `\n  非零漏检的面积分位 10/50/90 = ${
          (() => {
            const nz = missAreas.filter((a) => a > 0);
            const q = (p: number) => nz[Math.floor((nz.length * p) / 100)] ?? NaN;
            return `${q(10)} / ${q(50)} / ${q(90)}`;
          })()
        }`,
    );
    expect(presentAll).toBeGreaterThan(0);
  }, 300_000);

  /**
   * 红方无人机一帧都检不出 —— 到底卡在色相、饱和度还是明度上。
   *
   * SELF_MARKER_GREEN 是三个门限的合取（hue∈[68,90] ∧ S≥90 ∧ V≥90），
   * 只看合取结果是 0 说明不了任何事。把偏绿的像素（放宽到 hue 55..105、不设 S/V 门）
   * 全捞出来，看它们的 S/V 分布落在哪 —— 卡在哪一条上，就该调哪一条。
   */
  it('红方无人机的绿像素卡在哪个门限上', () => {
    const drones = loadFixtures(DIR).filter((f) => f.stream.includes('空中') && minimapPresent(f));
    const out: string[] = [];
    for (const stream of [...new Set(drones.map((f) => f.stream))].sort()) {
      const ss: number[] = [];
      const vs: number[] = [];
      const hs: number[] = [];
      let passHue = 0;
      let passHueS = 0;
      let passAll = 0;
      for (const f of drones.filter((x) => x.stream === stream)) {
        const r = resolveRect(DRONE_MINIMAP, f.frame.width, f.frame.height);
        for (let y = 0; y < r.h; y++) {
          let i = ((r.y + y) * f.frame.width + r.x) * 4;
          for (let x = 0; x < r.w; x++, i += 4) {
            const c = rgbToHsv(f.frame.data[i], f.frame.data[i + 1], f.frame.data[i + 2]);
            if (c.h < 55 || c.h > 105) continue;
            hs.push(c.h);
            ss.push(c.s);
            vs.push(c.v);
            passHue++;
            if (c.h >= SELF_MARKER_GREEN.hMin && c.h <= SELF_MARKER_GREEN.hMax) {
              if (c.s >= SELF_MARKER_GREEN.sMin) {
                passHueS++;
                if (c.v >= SELF_MARKER_GREEN.vMin) passAll++;
              }
            }
          }
        }
      }
      const q = (a: number[], p: number) => {
        const b = [...a].sort((x, y) => x - y);
        return b[Math.floor((b.length * p) / 100)] ?? NaN;
      };
      out.push(
        `  ${stream}\n` +
          `    偏绿像素(hue55..105) ${passHue}  → 过色相窗+S ${passHueS}  → 再过 V ${passAll}\n` +
          `    H 10/50/90 = ${q(hs, 10)} / ${q(hs, 50)} / ${q(hs, 90)}\n` +
          `    S 10/50/90 = ${q(ss, 10)} / ${q(ss, 50)} / ${q(ss, 90)}   （门限 ${SELF_MARKER_GREEN.sMin}）\n` +
          `    V 10/50/90 = ${q(vs, 10)} / ${q(vs, 50)} / ${q(vs, 90)}   （门限 ${SELF_MARKER_GREEN.vMin}）`,
      );
    }
    console.log('\n[无人机小地图里的偏绿像素]\n' + out.join('\n'));
    expect(out.length).toBeGreaterThan(0);
  }, 300_000);
});
