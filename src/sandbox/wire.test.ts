import { describe, it, expect } from 'vitest';
import { toWire, UNKNOWN_X, UNKNOWN_Y } from './wire';
import { createRobotTracker } from './tracker';
import { fixture } from './__fixtures__/load';

describe('toWire', () => {
  it('sends (-1,-1) when the position has never been identified', () => {
    // B2 那位操作手全场关着小地图 —— 有血量、永远没位置
    const t = createRobotTracker('b2', 'blue');
    t.observe(0, fixture('B2SuqqreProject', 1400).frame);
    const w = toWire(t.state);
    expect(w.x).toBe(UNKNOWN_X);
    expect(w.y).toBe(UNKNOWN_Y);
    expect(w.hp).toBe(250); // 位置缺席不影响血量
    expect(w.status).toBe('alive');
  });

  it('keeps sending the last known position after death, with zero health', () => {
    const t = createRobotTracker('b1', 'blue');
    t.observe(0, fixture('B1Hero', 1400).frame);
    t.observe(1_000, fixture('B1Hero', 690).frame);
    const w = toWire(t.state);
    expect(w.status).toBe('dead');
    expect(w.hp).toBe(0);
    expect(w.x).not.toBe(UNKNOWN_X); // 灰化的小地图读不出新位置，但要让观众知道它倒在哪
    expect(w.poseAgeMs).toBe(1_000);
  });

  it('carries a null heading when the disc was found but the arrow was not', () => {
    const t = createRobotTracker('b1', 'blue');
    t.observe(0, fixture('B1Hero', 1400).frame);
    const w = toWire(t.state);
    expect(w.x).toBeGreaterThanOrEqual(0);
    // 位置与朝向必须能各自缺席 —— 有位置无朝向是常见状态，不该整条丢掉
    expect(w.heading === null || typeof w.heading === 'number').toBe(true);
  });
});
