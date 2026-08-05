import { describe, it, expect } from 'vitest';
import { solve, snapPlan, planFor, GRID_GAP, GRID_TOTAL } from './gridSolve';

/** 容器尺寸的取样：窄/常规/宽 × 矮/常规/高，覆盖真实窗口的范围 */
const WIDTHS = [280, 360, 480, 600, 820, 1100];
const HEIGHTS = [320, 480, 640, 900];

describe('solve', () => {
  it('格子恒守 16:9', () => {
    for (const W of WIDTHS) {
      for (const H of HEIGHTS) {
        const p = solve(W, H, H * 0.6);
        expect(p.th).toBeCloseTo((p.tw * 9) / 16, 6);
      }
    }
  });

  it('列宽铺满机位区——横向不留白', () => {
    for (const W of WIDTHS) {
      for (const H of HEIGHTS) {
        const p = solve(W, H, H * 0.6);
        expect(p.cols * p.tw + GRID_GAP * (p.cols - 1)).toBeCloseTo(W, 6);
      }
    }
  });

  it('可见区高度精确等于整行——纵向不留缝', () => {
    for (const W of WIDTHS) {
      for (const H of HEIGHTS) {
        const p = solve(W, H, H * 0.6);
        expect(p.need).toBeCloseTo(p.rows * p.th + GRID_GAP * (p.rows - 1), 6);
      }
    }
  });

  it('十路恒在：totalRows 足以放下全部格子', () => {
    for (const W of WIDTHS) {
      for (const H of HEIGHTS) {
        const p = solve(W, H, H * 0.6);
        expect(p.cols * p.totalRows).toBeGreaterThanOrEqual(GRID_TOTAL);
        // 且不多排一整行无用的空行
        expect(p.cols * (p.totalRows - 1)).toBeLessThan(GRID_TOTAL);
      }
    }
  });

  it('可见行数不超过总行数，可见格子数不超过十', () => {
    for (const W of WIDTHS) {
      for (const H of HEIGHTS) {
        for (const frac of [0.1, 0.4, 0.7, 0.94]) {
          const p = solve(W, H, H * frac);
          expect(p.rows).toBeGreaterThanOrEqual(1);
          expect(p.rows).toBeLessThanOrEqual(p.totalRows);
          expect(p.visible).toBeLessThanOrEqual(GRID_TOTAL);
          expect(p.visible).toBe(Math.min(p.cols * p.rows, GRID_TOTAL));
        }
      }
    }
  });

  it('可见区不越过容器上限', () => {
    for (const W of WIDTHS) {
      for (const H of HEIGHTS) {
        const p = solve(W, H, H); // 要到顶也不能溢出
        expect(p.need).toBeLessThanOrEqual(H);
      }
    }
  });

  it('期望高度越大，可见区越不小于期望高度更小时的结果（单调）', () => {
    for (const W of WIDTHS) {
      const H = 640;
      let prev = 0;
      for (const frac of [0.15, 0.3, 0.5, 0.7, 0.9]) {
        const p = solve(W, H, H * frac);
        expect(p.need).toBeGreaterThanOrEqual(prev - 1e-6);
        prev = p.need;
      }
    }
  });

  it('放得下两列时，绝不解出「一格吃掉大半宽度」的退化排布', () => {
    // 少了宽度上限，某些高度会解出单列：两个巨格子占满机位区、其余八路全被盖住。
    // 654×880 下 topFrac=0.75 实测踩过这个坑（cols=1 / 可见 2 路）。
    for (const W of [480, 600, 654, 820, 1100]) {
      for (const H of HEIGHTS) {
        for (let frac = 0.1; frac <= 0.94; frac += 0.02) {
          const p = solve(W, H, H * frac);
          if (W >= Math.max(120, W * 0.22) * 2 + GRID_GAP) {
            expect(p.tw).toBeLessThanOrEqual(W * 0.55 + 1e-6);
            expect(p.cols).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('可见路数不随期望高度剧烈倒退', () => {
    // 机位区拖得更高却看得更少，是判据把「贴合光标」压过「多露几路」的症状。
    // 654×880 实测曾出现 0.30→10 路而 0.42→4 路。
    for (const W of [480, 654, 820, 1100]) {
      for (const H of [480, 640, 880]) {
        let prevVisible = 0;
        let prevNeed = 0;
        for (let frac = 0.2; frac <= 0.9; frac += 0.03) {
          const p = solve(W, H, H * frac);
          // 机位区变高时，可见路数最多回落 1 路（换列数导致的正常抖动），
          // 不允许出现「高度涨了、路数腰斩」
          if (p.need >= prevNeed) {
            expect(p.visible).toBeGreaterThanOrEqual(Math.min(prevVisible - 1, GRID_TOTAL));
          }
          prevVisible = p.visible;
          prevNeed = p.need;
        }
      }
    }
  });

  it('格子不窄于下限（除非一列都放不下）', () => {
    for (const W of WIDTHS) {
      const p = solve(W, 640, 400);
      if (p.cols > 1) expect(p.tw).toBeGreaterThanOrEqual(Math.max(120, W * 0.22) - 1e-6);
    }
  });

  it('极端容器也返回可用排布，不抛不产出 NaN', () => {
    for (const [W, H] of [[80, 60], [40, 900], [1600, 100], [1, 1]] as const) {
      const p = solve(W, H, H * 0.5);
      expect(Number.isFinite(p.tw)).toBe(true);
      expect(Number.isFinite(p.th)).toBe(true);
      expect(Number.isFinite(p.need)).toBe(true);
      expect(p.cols).toBeGreaterThanOrEqual(1);
      expect(p.rows).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('snapPlan', () => {
  it('吸附结果永远落在整行边界上', () => {
    for (const W of WIDTHS) {
      for (const H of HEIGHTS) {
        for (const frac of [0.05, 0.23, 0.5, 0.77, 0.99]) {
          const p = snapPlan(W, H, H * frac);
          expect(p.need).toBeCloseTo(p.rows * p.th + GRID_GAP * (p.rows - 1), 6);
        }
      }
    }
  });

  it('吸到的是最近的整行，不是任意一行', () => {
    const W = 600, H = 640;
    const base = solve(W, H, H);
    // 正落在第 2 行边界上时必须吸到 2 行
    const twoRows = 2 * base.th + GRID_GAP;
    expect(snapPlan(W, H, twoRows).rows).toBe(2);
    // 略偏一点仍吸回 2 行
    expect(snapPlan(W, H, twoRows + base.th * 0.2).rows).toBe(2);
    expect(snapPlan(W, H, twoRows - base.th * 0.2).rows).toBe(2);
  });

  it('吸附不改变列数——松手只挪边界，不重排', () => {
    for (const W of WIDTHS) {
      for (const H of HEIGHTS) {
        const base = solve(W, H, H);
        for (const frac of [0.1, 0.45, 0.8]) {
          expect(snapPlan(W, H, H * frac).cols).toBe(base.cols);
        }
      }
    }
  });

  it('落点再低也至少留一行，再高也不超总行数', () => {
    const W = 600, H = 640;
    expect(snapPlan(W, H, 0).rows).toBe(1);
    expect(snapPlan(W, H, -999).rows).toBe(1);
    const base = solve(W, H, H);
    expect(snapPlan(W, H, 99999).rows).toBeLessThanOrEqual(base.totalRows);
  });
});

describe('planFor', () => {
  it('锁定排布后只改尺寸，列行不变', () => {
    const H = 640;
    const base = solve(600, H, 400);
    for (const W of [420, 520, 600, 700, 860]) {
      const p = planFor(W, H, base.cols, base.rows);
      if (p.cols === base.cols) {
        expect(p.rows).toBeLessThanOrEqual(base.rows);
        expect(p.cols * p.tw + GRID_GAP * (p.cols - 1)).toBeCloseTo(W, 6);
        expect(p.th).toBeCloseTo((p.tw * 9) / 16, 6);
      }
    }
  });

  it('宽度缩到放不下锁定列数时，退回重新求解', () => {
    const H = 640;
    // 8 列在 300px 下每格远窄于下限，必须退回 solve
    const p = planFor(300, H, 8, 1);
    expect(p.cols).toBeLessThan(8);
    expect(p.tw).toBeGreaterThanOrEqual(Math.max(120, 300 * 0.22) - 1e-6);
  });

  it('高度不够时逐行收，不溢出容器', () => {
    const p = planFor(600, 200, 2, 5);
    expect(p.need).toBeLessThanOrEqual(200);
    expect(p.rows).toBeGreaterThanOrEqual(1);
  });
});
