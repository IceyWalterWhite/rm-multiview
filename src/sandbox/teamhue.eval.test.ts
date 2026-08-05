import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { loadFixtures, type FixtureFrame } from './__fixtures__/load';
import { rgbToHsv } from '../vision/hsv';
import { resolveRect } from '../vision/frame';
import { HP_BAR, TEAM_BLUE, TEAM_RED } from '../rmui/layout';

/**
 * 血条上阵营色的色相直方图，红蓝分开。
 *
 * 现网抓的一段里红方四路「血条亮」只有 4.7~39.5%、蓝方 64~70%，红方工程甚至
 * 90.5% 被判成阵亡 —— 工程车几乎不死，这个数字本身就说明判据出了问题而不是战况。
 * 怀疑是同一个 BT.601/709 偏移在咬 TEAM_RED：红色跨 0 点，窗口是 [172..8]（环形），
 * 上沿只有 8，色相整体 +2.5 就可能把红条推出去。
 *
 * 直方图按环形展开成 -12..+20（即 168..179 接 0..20），这样跨 0 点的簇不会被劈成两半。
 */
const DIR = 'D:/rmcap/browsercap';
const REF = 'D:/rmcap/eval540';
const dirs = ([['浏览器', DIR], ['ffmpeg', REF]] as [string, string][]).filter(([, d]) =>
  existsSync(`${d}/frames.json`),
);

/** 把 0..179 的色相映射到 -12..20 这段连续区间，跨 0 的红簇才看得出形状。 */
const unwrap = (h: number) => (h >= 160 ? h - 180 : h);

function hist(frames: FixtureFrame[], side: 'red' | 'blue') {
  const lo = side === 'red' ? -12 : 88;
  const bins = new Array(16).fill(0);
  for (const f of frames) {
    if (f.side !== side) continue;
    const r = resolveRect(HP_BAR, f.frame.width, f.frame.height);
    for (let y = 0; y < r.h; y++) {
      let i = ((r.y + y) * f.frame.width + r.x) * 4;
      for (let x = 0; x < r.w; x++, i += 4) {
        const c = rgbToHsv(f.frame.data[i], f.frame.data[i + 1], f.frame.data[i + 2]);
        if (c.s < TEAM_RED.sMin || c.v < TEAM_RED.vMin) continue;
        const u = side === 'red' ? unwrap(c.h) : c.h;
        const b = Math.floor((u - lo) / 2);
        if (b >= 0 && b < bins.length) bins[b]++;
      }
    }
  }
  const max = Math.max(...bins, 1);
  return bins
    .map((v, i) => {
      const from = lo + i * 2;
      const mark = side === 'red'
        ? from >= TEAM_RED.hMin - 180 && from <= TEAM_RED.hMax ? ' ←窗内' : ''
        : from >= TEAM_BLUE.hMin && from <= TEAM_BLUE.hMax ? ' ←窗内' : '';
      return `      H ${String(from).padStart(4)}..${String(from + 2).padStart(4)} ` +
        '#'.repeat(Math.round((30 * v) / max)) + (v ? ` ${v}` : '') + mark;
    })
    .join('\n');
}

describe.skipIf(dirs.length === 0)('血条阵营色的色相分布', () => {
  it('红方是不是被窗口上沿切掉了', () => {
    const out: string[] = [];
    for (const [label, dir] of dirs) {
      const frames = loadFixtures(dir).filter((f) => !f.stream.includes('空中'));
      out.push(
        `  ${label} · 红方（窗 ${TEAM_RED.hMin}..${TEAM_RED.hMax} 环形，即 -8..8）\n` + hist(frames, 'red') +
          `\n  ${label} · 蓝方（窗 ${TEAM_BLUE.hMin}..${TEAM_BLUE.hMax}）\n` + hist(frames, 'blue'),
      );
    }
    console.log('\n[血条色相直方图，S/V 已过门限]\n' + out.join('\n'));
    expect(out.length).toBeGreaterThan(0);
  }, 300_000);
});
