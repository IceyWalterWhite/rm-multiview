import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { barSaturationFromFrame } from '../matchstate/observe';
import { scoreboardLit, scoreboardSaturation } from './alive';
import { loadFixtures } from './__fixtures__/load';
import { HUD_PRESENT_BAR_SAT } from '../rmui/layout';

/**
 * 逐路拆开「HUD 为什么不亮」。**只看地面路。**
 *
 * 现网抓的一段里血条阵营色有一半以上的帧是 0 —— 必须分清是
 *   a) 机器人阵亡（赛事 UI 灰化：记分板还画着、但没有阵营色）
 *   b) 这一路压根没在放 FPV（记分板都没画）
 *   c) ROI 落错位置（那就是布局常量的问题）
 * 三者的处置完全不同，混在一个百分比里看不出任何东西。
 *
 * 空中路排除在外：**空中机器人没有血量**，它那一路没有血条也没有记分板
 * （实测三个 ROI 整片全黑）。拿这套判据去分类它，得到的每一个百分比都是无意义的 ——
 * 先前那版把空中路 35.7% 标成「疑阵亡」，而无人机根本不会阵亡。
 */
const DIR = 'D:/rmcap/browsercap';
const available = existsSync(`${DIR}/frames.json`);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);

describe.skipIf(!available)('HUD 缺席的成因', () => {
  it('逐路分解', () => {
    const frames = loadFixtures(DIR).filter((f) => !f.stream.includes('空中'));
    const byStream = new Map<string, typeof frames>();
    for (const f of frames) byStream.set(f.stream, [...(byStream.get(f.stream) ?? []), f]);

    const rows: string[] = [];
    for (const [stream, fs] of [...byStream.entries()].sort()) {
      let lit = 0;
      let dead = 0;
      let blank = 0;
      for (const f of fs) {
        const bar = barSaturationFromFrame(f.frame, f.side);
        if (bar >= HUD_PRESENT_BAR_SAT) { lit++; continue; }
        // 记分板还画着东西 = UI 在渲染，只是掉了色 → 阵亡；否则这一路没在放 FPV
        if (scoreboardLit(f.frame) >= 0.3) dead++;
        else blank++;
      }
      rows.push(
        `  ${stream.padEnd(14)} n=${String(fs.length).padStart(3)}  ` +
          `血条亮 ${String(pct(lit, fs.length)).padStart(5)}%  ` +
          `灰化(疑阵亡) ${String(pct(dead, fs.length)).padStart(5)}%  ` +
          `无 UI ${String(pct(blank, fs.length)).padStart(5)}%`,
      );
    }
    // 顺带看一眼记分板本身的成色，判断 b) 到底是不是「没画」
    const sb = frames.map((f) => scoreboardLit(f.frame)).sort((a, b) => a - b);
    const sat = frames.map((f) => scoreboardSaturation(f.frame)).sort((a, b) => a - b);
    const q = (a: number[], p: number) => a[Math.floor((a.length * p) / 100)].toFixed(3);
    console.log(
      '\n[HUD 缺席成因 · 浏览器现网]\n' + rows.join('\n') +
        `\n  记分板亮像素占比 5/50/95 = ${q(sb, 5)} / ${q(sb, 50)} / ${q(sb, 95)}` +
        `\n  记分板阵营色占比 5/50/95 = ${q(sat, 5)} / ${q(sat, 50)} / ${q(sat, 95)}`,
    );
    expect(rows.length).toBeGreaterThan(0);
  }, 300_000);
});
