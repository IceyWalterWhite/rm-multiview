import { describe, it, expect } from 'vitest';
import {
  FIELD_CENTER_Y,
  MINIMAP_SPAN_X,
  MINIMAP_U0,
  MINIMAP_V0,
  headingToYaw,
  insideField,
  minimapToField,
} from './fieldMap';

const deg = (r: number) => (r * 180) / Math.PI;

describe('minimapToField', () => {
  it('中心对称点映到场地中心', () => {
    const p = minimapToField(MINIMAP_U0, MINIMAP_V0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(FIELD_CENTER_Y, 6);
  });

  it('两侧基地图标落回 CAD 里的灯条位置', () => {
    // 实测：红方基地图标 u=0.0595、蓝方 u=0.9395（同一帧，两者中点即 U0）
    // CAD（field_final.glb 离线解）：基地/飞镖站复合装配的队色灯条在 x=±12.745
    const red = minimapToField(0.0595, MINIMAP_V0);
    const blue = minimapToField(0.9395, MINIMAP_V0);
    expect(red.x).toBeCloseTo(12.745, 1); // 红方=+X，画在小地图左边
    expect(blue.x).toBeCloseTo(-12.745, 1);
    // 两者都在中线上
    expect(red.y).toBeCloseTo(FIELD_CENTER_Y, 6);
    expect(blue.y).toBeCloseTo(FIELD_CENTER_Y, 6);
  });

  it('横轴翻转：u 增大则 X 减小', () => {
    expect(minimapToField(0.2, 0.5).x).toBeGreaterThan(minimapToField(0.8, 0.5).x);
  });

  it('纵轴翻转：v 增大则 Y 减小', () => {
    expect(minimapToField(0.5, 0.2).y).toBeGreaterThan(minimapToField(0.5, 0.8).y);
  });

  it('满幅对应木质底板宽度', () => {
    expect(minimapToField(0, 0.5).x - minimapToField(1, 0.5).x).toBeCloseTo(MINIMAP_SPAN_X, 6);
  });
});

describe('headingToYaw', () => {
  /**
   * 两个轴都翻向，方向向量取负两次 —— 所以是整体旋转 π，不是取负。
   * 这条最容易凭直觉写错，逐个象限钉住。
   */
  it('小地图正右 = 场地 −X', () => {
    expect(deg(headingToYaw(0))).toBeCloseTo(180, 6);
  });

  it('小地图正下 = 场地 +Y', () => {
    // 屏幕 y 向下为正，场地 Y 向上为正
    expect(deg(headingToYaw(Math.PI / 2))).toBeCloseTo(-90, 6);
  });

  it('小地图正左 = 场地 +X', () => {
    expect(deg(headingToYaw(Math.PI))).toBeCloseTo(0, 6);
  });

  it('结果始终落在 (−π, π]', () => {
    for (let d = -180; d <= 180; d += 15) {
      const y = headingToYaw((d * Math.PI) / 180);
      expect(y).toBeGreaterThan(-Math.PI - 1e-9);
      expect(y).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('insideField', () => {
  it('场地中心在内、场外在外', () => {
    expect(insideField(0, FIELD_CENTER_Y)).toBe(true);
    expect(insideField(13.9, 1.6)).toBe(true);
    expect(insideField(14.5, 1.6)).toBe(false); // 木质底板上但已出比赛场地
    expect(insideField(0, 10)).toBe(false);
  });
});
