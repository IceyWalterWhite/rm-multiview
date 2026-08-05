import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { detectSelfMarker } from './marker';
import { fixture, loadFixtures, type FixtureFrame } from './__fixtures__/load';
import { barSaturationFromFrame } from '../matchstate/observe';
import { HUD_PRESENT_BAR_SAT, MINIMAP, SELF_MARKER_GREEN, SELF_MARKER_MIN_AREA_RATIO } from '../rmui/layout';

/**
 * 放宽色相上沿会不会把相邻的蓝方图标**并进**自机那一团。
 *
 * 多候选率查不到这种情况 —— 它只数「有几个够大的连通域」。绿标记与青图标之间
 * 若被过渡像素桥接上，两者会合成一个域，候选数仍是 1，而质心被悄悄拽走。
 * committed 夹具里 B1Hero@1400 正是这种构图（测试名就叫「蓝方图标把掩码打碎时」），
 * 上沿从 86 放到 90 时它的圆心偏了 2.2px —— 这条测试红了才暴露出来。
 *
 * 判据用**面积**：自机图标大小是固定的，面积随上沿单调暴涨就说明在吃邻居。
 */
const BROWSER = 'D:/rmcap/browsercap';
const isDrone = (f: FixtureFrame) => f.stream.includes('空中');
const hudOn = (f: FixtureFrame) => barSaturationFromFrame(f.frame, f.side) >= HUD_PRESENT_BAR_SAT;

const H_MAX = [86, 88, 90, 92, 95];

describe('色相上沿对连通域面积的影响', () => {
  it('committed 夹具里那个蓝方图标贴身的构图', () => {
    const f = fixture('B1Hero', 1400).frame;
    const rows = H_MAX.map((hMax) => {
      const m = detectSelfMarker(f, MINIMAP, SELF_MARKER_MIN_AREA_RATIO, { ...SELF_MARKER_GREEN, hMax });
      return `    hMax=${String(hMax).padEnd(3)} 面积 ${String(m?.area ?? 0).padStart(4)}px  ` +
        `圆心 (${m ? m.x.toFixed(4) : '-'}, ${m ? m.y.toFixed(4) : '-'})  半径 ${m?.radius.toFixed(1) ?? '-'}`;
    });
    console.log('\n[B1Hero@1400 —— 蓝方图标贴身]\n' + rows.join('\n'));
    expect(rows.length).toBe(H_MAX.length);
  });

  it.skipIf(!existsSync(`${BROWSER}/frames.json`))('浏览器现网数据上的面积分布', () => {
    const ground = loadFixtures(BROWSER).filter((f) => !isDrone(f) && hudOn(f));
    const rows = H_MAX.map((hMax) => {
      const areas = ground
        .map((f) => detectSelfMarker(f.frame, MINIMAP, SELF_MARKER_MIN_AREA_RATIO, { ...SELF_MARKER_GREEN, hMax }))
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .map((m) => m.area)
        .sort((a, b) => a - b);
      const q = (p: number) => areas[Math.floor((areas.length * p) / 100)] ?? NaN;
      return `    hMax=${String(hMax).padEnd(3)} n=${String(areas.length).padStart(3)}  ` +
        `面积 10/50/90/99 = ${q(10)} / ${q(50)} / ${q(90)} / ${q(99)}  最大 ${areas[areas.length - 1]}`;
    });
    console.log('\n[浏览器现网 —— 自机团面积分位]\n' + rows.join('\n'));
    expect(rows.length).toBe(H_MAX.length);
  }, 600_000);
});
