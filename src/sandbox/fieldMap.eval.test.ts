import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { loadFixtures, type FixtureFrame } from './__fixtures__/load';
import { detectSelfMarker } from './marker';
import { insideField, minimapToField } from './fieldMap';
import {
  DRONE_MARKER_MIN_AREA_RATIO,
  DRONE_MINIMAP,
  MINIMAP,
  SELF_MARKER_MIN_AREA_RATIO,
} from '../rmui/layout';

/**
 * 场地变换在现网检出上的验收。
 *
 * 这里只有两条**弱**约束可用 —— 机器人在场上的真实坐标我无从获知：
 *   1. 落在场地内（越界一定错，落内不一定对）；
 *   2. 落在本方半场（对开局与死守阶段成立，混战时不成立）。
 * 空中路的常数是从地面那组折算来的，能过的也只有这两条。别把它当成精度证明。
 */
const DIR = 'D:/rmcap/browsercap';
const isDrone = (f: FixtureFrame) => f.stream.includes('空中');
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);

function poses(frames: FixtureFrame[], drone: boolean) {
  const out: Array<{ side: string; x: number; y: number }> = [];
  for (const f of frames) {
    const m = drone
      ? detectSelfMarker(f.frame, DRONE_MINIMAP, DRONE_MARKER_MIN_AREA_RATIO)
      : detectSelfMarker(f.frame, MINIMAP, SELF_MARKER_MIN_AREA_RATIO);
    if (!m) continue;
    const p = minimapToField(m.x, m.y, drone ? 'drone' : 'ground');
    out.push({ side: f.side, x: p.x, y: p.y });
  }
  return out;
}

describe.skipIf(!existsSync(`${DIR}/frames.json`))('场地变换 · 现网检出', () => {
  it('地面检出绝大多数落在场地内，蓝方绝大多数落在蓝半场', () => {
    const ps = poses(
      loadFixtures(DIR).filter((f) => !isDrone(f)),
      false,
    );
    expect(ps.length).toBeGreaterThan(100);
    const inside = ps.filter((p) => insideField(p.x, p.y)).length;
    expect(pct(inside, ps.length)).toBeGreaterThan(90);

    const blue = ps.filter((p) => p.side === 'blue');
    const blueOwn = blue.filter((p) => p.x < 0).length;
    // 红方样本此时几乎全灭，样本量不足以判断，不作断言（见 fieldMap.ts 标定说明）
    expect(pct(blueOwn, blue.length)).toBeGreaterThan(80);
  }, 180_000);

  it('空中路用自己那组常数：落在场地内，且蓝方无人机在蓝半场', () => {
    const ps = poses(
      loadFixtures(DIR).filter(isDrone),
      true,
    );
    expect(ps.length).toBeGreaterThan(10);
    const inside = ps.filter((p) => insideField(p.x, p.y)).length;
    expect(pct(inside, ps.length)).toBeGreaterThan(90);
    const blue = ps.filter((p) => p.side === 'blue');
    expect(blue.length).toBeGreaterThan(10);
    expect(pct(blue.filter((p) => p.x < 0).length, blue.length)).toBeGreaterThan(80);
  }, 180_000);

  it('空中路套地面常数会更差 —— 这就是单开一组的理由', () => {
    const frames = loadFixtures(DIR).filter(isDrone);
    const withDroneConst = poses(frames, true);
    // 同一批检出，换成地面常数
    const withGroundConst: Array<{ x: number; y: number }> = [];
    for (const f of frames) {
      const m = detectSelfMarker(f.frame, DRONE_MINIMAP, DRONE_MARKER_MIN_AREA_RATIO);
      if (!m) continue;
      withGroundConst.push(minimapToField(m.x, m.y, 'ground'));
    }
    const insideDrone = withDroneConst.filter((p) => insideField(p.x, p.y)).length;
    const insideGround = withGroundConst.filter((p) => insideField(p.x, p.y)).length;
    expect(insideDrone).toBeGreaterThanOrEqual(insideGround);
  }, 180_000);
});
