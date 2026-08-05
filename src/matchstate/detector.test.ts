import { describe, it, expect } from 'vitest';
import { reduce } from './detector';
import { classify, SILENCE_DBFS } from './signals';
import { rmsDbFromSamples } from './observe';
import { initialState, type StreamObservation } from './types';

const audio = (streamId: string, db: number | null): StreamObservation => ({
  streamId,
  audioDb: db,
  barSaturation: null,
});
const pixels = (streamId: string, sat: number | null): StreamObservation => ({
  streamId,
  audioDb: null,
  barSaturation: sat,
});

describe('classify', () => {
  it('calls the round live when any FPV stream carries sound', () => {
    // 等待卡是所有路同时数字静音，所以「有一路出声」就足以断定回合已开
    expect(classify([audio('a', -120), audio('b', -28)])).toMatchObject({ live: true, source: 'audio' });
  });

  it('calls the round idle when every FPV stream is digitally silent', () => {
    expect(classify([audio('a', -Infinity), audio('b', -120)])).toMatchObject({ live: false, source: 'audio' });
  });

  it('prefers audio over pixels when both are available', () => {
    const obs: StreamObservation[] = [{ streamId: 'a', audioDb: -30, barSaturation: 0 }];
    expect(classify(obs)).toMatchObject({ live: true, source: 'audio' });
  });

  it('falls back to any lit bar when no audio is available', () => {
    expect(classify([pixels('a', 0.9), pixels('b', 0.5), pixels('c', 0)])).toMatchObject({
      live: true,
      source: 'visual',
      sampled: 3,
    });
    // 一方被团灭：只剩一路亮着，回合仍在进行。
    // 这里原先要求「过半」，被 2026-08-04 现网数据否决 —— 见 signals.ts 里那条逐轮曲线。
    expect(classify([pixels('a', 0.001), pixels('b', 0), pixels('c', 0.9)])).toMatchObject({
      live: true,
      source: 'visual',
    });
    // 回合间歇：一路都不亮才是未开赛
    expect(classify([pixels('a', 0.001), pixels('b', 0), pixels('c', 0.002)])).toMatchObject({
      live: false,
      source: 'visual',
    });
  });

  it('reports no evidence rather than guessing when every channel is blocked', () => {
    expect(classify([{ streamId: 'a', audioDb: null, barSaturation: null }])).toMatchObject({
      live: null,
      source: 'none',
    });
    expect(classify([])).toMatchObject({ live: null, source: 'none' });
  });
});

describe('reduce', () => {
  const live = classify([audio('a', -30)]);
  const idle = classify([audio('a', -Infinity)]);

  it('waits out the hysteresis window before entering live', () => {
    let s = initialState(0);
    s = reduce(s, 0, live);
    expect(s.phase).toBe('idle');
    s = reduce(s, 1_900, live);
    expect(s.phase).toBe('idle');
    s = reduce(s, 2_000, live);
    expect(s.phase).toBe('live');
    expect(s.since).toBe(2_000);
  });

  it('holds live through a brief silence, since dropping mid-round is the costlier error', () => {
    let s = reduce(reduce(initialState(0), 0, live), 2_000, live);
    expect(s.phase).toBe('live');
    s = reduce(s, 3_000, idle);
    s = reduce(s, 9_000, idle); // 6s 静音还不够
    expect(s.phase).toBe('live');
    s = reduce(s, 11_000, idle);
    expect(s.phase).toBe('idle');
  });

  it('resets a partially-elapsed transition when the evidence flips back', () => {
    let s = reduce(reduce(initialState(0), 0, live), 2_000, live);
    s = reduce(s, 3_000, idle);
    s = reduce(s, 5_000, live); // 证据回摆，候选作废
    s = reduce(s, 6_000, idle);
    s = reduce(s, 12_000, idle);
    expect(s.phase).toBe('live'); // 从 6_000 才重新计时，8s 未满
    s = reduce(s, 14_001, idle);
    expect(s.phase).toBe('idle');
  });

  it('freezes on missing evidence instead of flipping, and restarts the clock afterwards', () => {
    let s = reduce(reduce(initialState(0), 0, live), 2_000, live);
    const blind = classify([]);
    s = reduce(s, 3_000, idle);
    s = reduce(s, 4_000, blind); // 断采：清掉半路的候选
    expect(s.phase).toBe('live');
    expect(s.pending).toBeNull();
    s = reduce(s, 60_000, idle); // 恢复采样，重新起算而不是立刻翻转
    expect(s.phase).toBe('live');
    s = reduce(s, 68_001, idle);
    expect(s.phase).toBe('idle');
  });
});

describe('rmsDbFromSamples', () => {
  it('returns -Infinity for the digitally silent waiting card', () => {
    expect(rmsDbFromSamples(new Float32Array(512))).toBe(-Infinity);
    expect(rmsDbFromSamples(new Float32Array(512))).toBeLessThan(SILENCE_DBFS);
  });

  it('measures full-scale and half-scale tones', () => {
    expect(rmsDbFromSamples(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(0, 6);
    expect(rmsDbFromSamples(new Float32Array([0.5, -0.5]))).toBeCloseTo(-6.02, 2);
  });

  it('puts commentary-level audio comfortably above the silence threshold', () => {
    // 实测回合中 RMS 中位数约 -30dBFS
    const s = new Float32Array(256);
    for (let i = 0; i < s.length; i++) s[i] = i % 2 === 0 ? 0.032 : -0.032;
    expect(rmsDbFromSamples(s)).toBeGreaterThan(SILENCE_DBFS);
  });
});
