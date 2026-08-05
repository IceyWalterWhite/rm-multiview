import { describe, it, expect } from 'vitest';
import { detectSelfMarker } from './marker';
import { fixture, loadFixtures } from './__fixtures__/load';

/** 屏幕坐标 y 向下，所以 -90° 是正上方、+90° 是正下方。 */
const deg = (rad: number) => (rad * 180) / Math.PI;

describe('detectSelfMarker', () => {
  it('agrees with the hand-checked expectation on every fixture frame', () => {
    // expectMarker=null 的帧只抽了血条 ROI（纯字形样本），没有小地图可判
    const judged = loadFixtures().filter((f) => f.expectMarker !== null);
    expect(judged.length).toBeGreaterThan(10);
    const wrong = judged
      .map((f) => ({ f, got: detectSelfMarker(f.frame) !== null }))
      .filter(({ f, got }) => got !== f.expectMarker)
      .map(({ f }) => `${f.stream}@${f.t}s`);
    expect(wrong).toEqual([]);
  });

  it('returns nothing while the robot is dead and the whole HUD is greyed out', () => {
    expect(detectSelfMarker(fixture('B1Hero', 690).frame)).toBeNull();
  });

  it('returns nothing on the pre-match waiting card', () => {
    expect(detectSelfMarker(fixture('B1Hero', 300).frame)).toBeNull();
  });

  it('returns nothing for the operator who keeps the minimap switched off', () => {
    // B2 全场没有小地图（实测 54/54 采样点 0 命中）。这一路只能贡献血量。
    expect(detectSelfMarker(fixture('B2SuqqreProject', 1400).frame)).toBeNull();
  });

  it('keeps every detection inside the minimap', () => {
    for (const f of loadFixtures()) {
      const m = detectSelfMarker(f.frame);
      if (!m) continue;
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(1);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(1);
      expect(m.radius).toBeGreaterThan(1);
    }
  });

  // 下面四条的方向都在 tools/sandbox/annotate.py 渲染的标注图上肉眼核对过。
  // 断言方向而不是把 12 个坐标全部写死：方向是有语义的，坐标只是数字。
  it('reads a north-pointing arrow', () => {
    const m = detectSelfMarker(fixture('R3Infantry', 1420).frame)!;
    expect(deg(m.heading!)).toBeGreaterThan(-105);
    expect(deg(m.heading!)).toBeLessThan(-75);
  });

  it('reads an east-pointing arrow', () => {
    const m = detectSelfMarker(fixture('R2SuqqreProject', 600).frame)!;
    expect(Math.abs(deg(m.heading!))).toBeLessThan(20);
  });

  it('reads a west-pointing arrow across the atan2 discontinuity', () => {
    const m = detectSelfMarker(fixture('B1Hero', 1620).frame)!;
    expect(Math.abs(deg(m.heading!))).toBeGreaterThan(160);
  });

  it('reads a south-east-pointing arrow', () => {
    const m = detectSelfMarker(fixture('R4Infantry', 1400).frame)!;
    expect(deg(m.heading!)).toBeGreaterThan(30);
    expect(deg(m.heading!)).toBeLessThan(90);
  });

  it('ignores the power rune sharing the minimap', () => {
    // R3@1420 的小地图正中有个黄绿色能量机关星形（色相≈42，面积比自机还大）。
    // 命中位置必须落在左下角的自机上，而不是被那颗星吸过去。
    const m = detectSelfMarker(fixture('R3Infantry', 1420).frame)!;
    expect(m.x).toBeLessThan(0.25);
    expect(m.y).toBeGreaterThan(0.6);
  });

  it('locks the disc centre onto the marker even when blue icons fragment the mask', () => {
    // B1@1400 自机压在一簇蓝方图标上，掩码会碎成两块；
    // 圆心走距离场峰值而不是质心，所以碎裂不会把中心拽走。
    //
    // 期望值随 SELF_MARKER_GREEN 上沿 86→90 从 (0.610, 0.854) 挪到 (0.6045, 0.850)。
    // 挪的是估计精度不是目标：上沿放宽后这一团不再碎（面积 66→72px、
    // 距离场峰值半径 2.7→3.3），圆盘更完整，峰值质心也就更准。
    // 判据是收敛性 —— 上沿取 88/90/92/95 四档给出的坐标**完全相同**，
    // 只有 86 是离群的那个；被邻居拽走的话应当越放越飘。
    const m = detectSelfMarker(fixture('B1Hero', 1400).frame)!;
    expect(m.x).toBeCloseTo(0.6045, 3);
    expect(m.y).toBeCloseTo(0.85, 3);
  });

  it('survives a frame with no minimap content at all', () => {
    const blank = { data: new Uint8ClampedArray(852 * 480 * 4), width: 852, height: 480 };
    expect(detectSelfMarker(blank)).toBeNull();
  });

  it('does not throw on a frame smaller than the ROI', () => {
    const tiny = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    expect(() => detectSelfMarker(tiny)).not.toThrow();
  });
});
