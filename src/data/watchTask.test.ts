import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildLoginUrl, fetchWatchProgress, normalizeWatchProgress } from './watchTask';
import { WATCH_PROGRESS_URL } from '../config';

function mockFetch(body: unknown) {
  const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

// 线上实测的三档：7/10/30 分钟，每档增量 500/1000/3000 → 累计 500/1500/4500
const TIERS = [
  { tier: 1, thresholdSeconds: 420, amount: 500, granted: true },
  { tier: 2, thresholdSeconds: 600, amount: 1000, granted: true },
  { tier: 3, thresholdSeconds: 1800, amount: 3000, granted: false },
];

describe('normalizeWatchProgress', () => {
  const p = normalizeWatchProgress({ accumulatedSeconds: 900, tiers: TIERS });

  it('accumulates amount into pellets and keeps the per-tier increment', () => {
    expect(p.tiers.map((t) => t.pellets)).toEqual([500, 1500, 4500]);
    expect(p.tiers.map((t) => t.increment)).toEqual([500, 1000, 3000]);
  });

  it('derives minutes from thresholdSeconds', () => {
    expect(p.tiers.map((t) => t.minutes)).toEqual([7, 10, 30]);
    expect(p.tiers.map((t) => t.seconds)).toEqual([420, 600, 1800]);
  });

  it('takes earnedPellets from the last granted tier', () => {
    expect(p.earnedPellets).toBe(1500);
    expect(p.accumulatedSeconds).toBe(900);
  });

  it('sorts by tier before accumulating (接口不保证顺序)', () => {
    const shuffled = normalizeWatchProgress({ tiers: [TIERS[2], TIERS[0], TIERS[1]] });
    expect(shuffled.tiers.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(shuffled.tiers.map((t) => t.pellets)).toEqual([500, 1500, 4500]);
  });

  it('reports 0 earned when nothing is granted yet', () => {
    expect(normalizeWatchProgress({ tiers: [{ tier: 1, thresholdSeconds: 420, amount: 500 }] }).earnedPellets).toBe(0);
  });

  it('degrades empty/garbage payloads instead of throwing', () => {
    expect(normalizeWatchProgress(null)).toEqual({ accumulatedSeconds: 0, tiers: [], earnedPellets: 0 });
    expect(normalizeWatchProgress({ tiers: 'nope' }).tiers).toEqual([]);
    expect(normalizeWatchProgress({ tiers: [{ tier: 1, amount: 'x' }] }).tiers[0].increment).toBe(0);
  });
});

describe('fetchWatchProgress', () => {
  it('posts an empty body as text/plain and normalizes the response', async () => {
    const fn = mockFetch({ data: { accumulatedSeconds: 900, tiers: TIERS }, code: 'S0000', success: true });
    const p = await fetchWatchProgress();
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WATCH_PROGRESS_URL);
    // 这是本站唯一还能发出去的官方调用，形态不能变（见 data/saas.ts 的注释）
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(init.credentials).toBe('include');
    expect(p.accumulatedSeconds).toBe(900);
    expect(p.earnedPellets).toBe(1500);
  });

  it('rejects when not logged in (B200000)', async () => {
    mockFetch({ code: 'B200000', msg: '请登录后再操作', success: false });
    await expect(fetchWatchProgress()).rejects.toMatchObject({ code: 'B200000' });
  });
});

describe('buildLoginUrl', () => {
  it('encodes the back url and pins locale', () => {
    expect(buildLoginUrl('https://rmlive.cn/?a=1&b=2')).toBe(
      'https://www.robomaster.com/api/members/oauth?backurl=https%3A%2F%2Frmlive.cn%2F%3Fa%3D1%26b%3D2&locale=zh_CN',
    );
  });
});
