import { describe, it, expect } from 'vitest';
import {
  FIELD_CENTER_Y,
  MINIMAP_SPAN_X,
  MINIMAP_U0,
  MINIMAP_V0,
  OBJECTIVE_MAX_HP,
  OBJECTIVE_SITES,
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

  it('纵轴不翻转：v 增大则 Y 增大（2026-08-06 现网实测钉下的方向）', () => {
    expect(minimapToField(0.5, 0.2).y).toBeLessThan(minimapToField(0.5, 0.8).y);
  });

  it('满幅对应木质底板宽度', () => {
    expect(minimapToField(0, 0.5).x - minimapToField(1, 0.5).x).toBeCloseTo(MINIMAP_SPAN_X, 6);
  });
});

describe('headingToYaw', () => {
  /**
   * 只有横轴翻向 —— 是绕纵轴的镜像（yaw = π − θ），不是旋转 π。
   * 这条最容易凭直觉写错，逐个象限钉住。
   */
  it('小地图正右 = 场地 −X', () => {
    expect(deg(headingToYaw(0))).toBeCloseTo(180, 6);
  });

  it('小地图正下 = 场地 +Y', () => {
    // 屏幕 y 向下为正，场地 Y 与小地图 v 同向（2026-08-06 现网实测）
    expect(deg(headingToYaw(Math.PI / 2))).toBeCloseTo(90, 6);
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

describe('OBJECTIVE_SITES', () => {
  it('四个目标都在比赛场地内', () => {
    for (const [name, at] of Object.entries(OBJECTIVE_SITES)) {
      expect(insideField(at.x, at.y), name).toBe(true);
    }
  });

  // 场地是绕中心 (0, FIELD_CENTER_Y) 的 180° 旋转对称，红蓝同名设施必须互为对称点。
  // 这条约束一破，血条就会钉在空地上 —— 而那在截图上看着仍然"像对的"。
  it.each([
    ['base', 'redBase', 'blueBase'],
    ['outpost', 'redOutpost', 'blueOutpost'],
  ] as const)('%s 红蓝互为 180° 对称点', (_kind, red, blue) => {
    const r = OBJECTIVE_SITES[red];
    const b = OBJECTIVE_SITES[blue];
    expect(r.x + b.x).toBeCloseTo(0, 6);
    expect((r.y + b.y) / 2).toBeCloseTo(FIELD_CENTER_Y, 6);
  });

  it('基地在两端、前哨站在半场中部', () => {
    expect(Math.abs(OBJECTIVE_SITES.redBase.x)).toBeGreaterThan(11);
    expect(Math.abs(OBJECTIVE_SITES.redOutpost.x)).toBeLessThan(5);
  });

  it('满血值照规则手册：基地 5000、前哨站 1500', () => {
    expect(OBJECTIVE_MAX_HP).toEqual({ base: 5000, outpost: 1500 });
  });
});
