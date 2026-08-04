import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWatchTask, type WatchTaskDeps } from './useWatchTask';
import { normalizeWatchProgress } from '../data/watchTask';
import { SaasError } from '../data/saas';
import { RM_OFFICIAL_LIVE_URL } from '../config';
import type { ZoneCatalog } from '../types';
import type { OfficialBridgeApi } from './useOfficialBridge';

// 线上实测三档：7/10/30 分钟，累计弹丸 500/1500/4500
const RAW_TIERS = [
  { tier: 1, thresholdSeconds: 420, amount: 500, granted: true },
  { tier: 2, thresholdSeconds: 600, amount: 1000, granted: true },
  { tier: 3, thresholdSeconds: 1800, amount: 3000, granted: false },
];
const PROGRESS = normalizeWatchProgress({ accumulatedSeconds: 900, tiers: RAW_TIERS });

const BACK_URL = 'https://rmlive.cn/';
const deps = (over: Partial<WatchTaskDeps> = {}): WatchTaskDeps => ({
  fetchProgress: async () => PROGRESS,
  backUrl: BACK_URL,
  ...over,
});

const catalog = (over: Partial<ZoneCatalog> = {}): ZoneCatalog => ({
  zoneName: '北部赛区', chatRoomId: 'r',
  main: { id: 'm', role: '主视角', side: 'main', sources: [] },
  redViews: [], blueViews: [], zoneId: '617', liveState: 1, matchState: 1, openVote: 1,
  ...over,
});

const bridge = (request: OfficialBridgeApi['request'], status: OfficialBridgeApi['status'] = 'ready') => ({
  status,
  request,
  retry: vi.fn(async () => {}),
}) satisfies OfficialBridgeApi;

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'hidden', { configurable: true, value: v === 'hidden' });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: v });
  document.dispatchEvent(new Event('visibilitychange'));
}

const settle = () => act(async () => {});
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

describe('useWatchTask', () => {
  beforeEach(() => { vi.useFakeTimers(); setVisibility('visible'); });
  afterEach(() => { vi.useRealTimers(); setVisibility('visible'); });

  describe('只读进度（本站不计时，见文件头）', () => {
    it('exposes the progress accumulated on the official site', async () => {
      const { result } = renderHook(() => useWatchTask(deps()));
      await settle();
      expect(result.current.loggedIn).toBe(true);
      expect(result.current.accumulatedSeconds).toBe(900);
      expect(result.current.earnedPellets).toBe(1500);
      expect(result.current.tiers.map((t) => t.minutes)).toEqual([7, 10, 30]);
      expect(result.current.tiers.map((t) => t.pellets)).toEqual([500, 1500, 4500]);
      expect(result.current.officialUrl).toBe(RM_OFFICIAL_LIVE_URL);
    });

    it('reads exactly once on mount and never on a timer', async () => {
      // 时长只在官网侧变化，本站没有心跳可发，也就没有轮询的理由
      const fetchProgress = vi.fn(async () => PROGRESS);
      renderHook(() => useWatchTask(deps({ fetchProgress })));
      await settle();
      expect(fetchProgress).toHaveBeenCalledTimes(1);
      await advance(300_000);
      expect(fetchProgress).toHaveBeenCalledTimes(1);
    });

    it('treats a blocked cross-site request the same as logged out (不报错，只给登录入口)', async () => {
      const fetchProgress = async () => { throw new TypeError('Failed to fetch'); };
      const { result } = renderHook(() => useWatchTask(deps({ fetchProgress })));
      await settle();
      expect(result.current.loggedIn).toBe(false);
      expect(result.current.accumulatedSeconds).toBe(0);
      expect(result.current.loginUrl).toBe(
        'https://www.robomaster.com/api/members/oauth?backurl=https%3A%2F%2Frmlive.cn%2F&locale=zh_CN',
      );
    });

    it('reports logged out on the official unauthenticated code', async () => {
      const fetchProgress = async () => { throw new SaasError('请登录后再操作', 'B200000'); };
      const { result } = renderHook(() => useWatchTask(deps({ fetchProgress })));
      await settle();
      expect(result.current.loggedIn).toBe(false);
      expect(result.current.tiers).toEqual([]);
    });

    it('defaults the login back-url to the current page', async () => {
      const { result } = renderHook(() => useWatchTask(deps({ backUrl: undefined })));
      await settle();
      expect(result.current.loginUrl).toContain(`backurl=${encodeURIComponent(window.location.href)}`);
    });
  });

  describe('回到前台补取', () => {
    it('refreshes when the user comes back from the official page', async () => {
      let n = 0;
      const fetchProgress = vi.fn(async () =>
        (++n === 1 ? PROGRESS : normalizeWatchProgress({ accumulatedSeconds: 1800, tiers: RAW_TIERS })));
      const { result } = renderHook(() => useWatchTask(deps({ fetchProgress })));
      await settle();
      expect(result.current.accumulatedSeconds).toBe(900);

      vi.advanceTimersByTime(31_000); // 越过限流
      await act(async () => { setVisibility('hidden'); setVisibility('visible'); });
      expect(fetchProgress).toHaveBeenCalledTimes(2);
      expect(result.current.accumulatedSeconds).toBe(1800);
    });

    it('picks up a login that happened in another tab', async () => {
      let n = 0;
      const fetchProgress = vi.fn(async () => {
        if (++n === 1) throw new SaasError('请登录后再操作', 'B200000');
        return PROGRESS;
      });
      const { result } = renderHook(() => useWatchTask(deps({ fetchProgress })));
      await settle();
      expect(result.current.loggedIn).toBe(false);

      vi.advanceTimersByTime(31_000);
      await act(async () => { setVisibility('hidden'); setVisibility('visible'); });
      expect(result.current.loggedIn).toBe(true);
    });

    it('throttles repeated tab switches', async () => {
      const fetchProgress = vi.fn(async () => PROGRESS);
      renderHook(() => useWatchTask(deps({ fetchProgress })));
      await settle();
      await act(async () => { setVisibility('hidden'); setVisibility('visible'); });
      await act(async () => { setVisibility('hidden'); setVisibility('visible'); });
      expect(fetchProgress).toHaveBeenCalledTimes(1);
    });

    it('stops listening after unmount', async () => {
      const fetchProgress = vi.fn(async () => PROGRESS);
      const { unmount } = renderHook(() => useWatchTask(deps({ fetchProgress })));
      await settle();
      unmount();
      vi.advanceTimersByTime(60_000);
      await act(async () => { setVisibility('hidden'); setVisibility('visible'); });
      expect(fetchProgress).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tampermonkey 观看心跳', () => {
    it('starts only after a bridge progress sync and stops immediately when playback pauses', async () => {
      const request = vi.fn(async (action: string) => (
        action === 'getWatchProgress'
          ? { accumulatedSeconds: 900, tiers: RAW_TIERS }
          : { accumulatedSeconds: 905, rewarded: false }
      )) as unknown as OfficialBridgeApi['request'];
      const b = bridge(request);
      const { result, rerender } = renderHook(
        ({ playing }) => useWatchTask(deps({
          bridge: b, catalog: catalog(), mainPlaying: playing, heartbeatMs: 5_000,
        })),
        { initialProps: { playing: true } },
      );
      await settle();
      expect(request).toHaveBeenCalledWith('getWatchProgress', {});
      expect(result.current.loggedIn).toBe(true);
      await advance(5_000);
      expect(request).toHaveBeenCalledWith('heartbeat', { zoneId: '617' });
      expect(result.current.accumulatedSeconds).toBe(905);

      const heartbeatCalls = (request as ReturnType<typeof vi.fn>).mock.calls
        .filter(([action]) => action === 'heartbeat').length;
      rerender({ playing: false });
      await advance(30_000);
      expect((request as ReturnType<typeof vi.fn>).mock.calls
        .filter(([action]) => action === 'heartbeat')).toHaveLength(heartbeatCalls);
      expect(result.current.heartbeatStatus).toBe('idle');
    });

    it('does not heartbeat when any official live gate is closed', async () => {
      const request = vi.fn(async () => ({ accumulatedSeconds: 900, tiers: RAW_TIERS })) as unknown as OfficialBridgeApi['request'];
      renderHook(() => useWatchTask(deps({
        bridge: bridge(request), catalog: catalog({ liveState: 0 }), mainPlaying: true, heartbeatMs: 5_000,
      })));
      await settle();
      await advance(30_000);
      expect((request as ReturnType<typeof vi.fn>).mock.calls.some(([action]) => action === 'heartbeat')).toBe(false);
    });

    it('stops in the background and re-syncs progress before resuming', async () => {
      const request = vi.fn(async (action: string) => (
        action === 'getWatchProgress'
          ? { accumulatedSeconds: 900, tiers: RAW_TIERS }
          : { accumulatedSeconds: 905, rewarded: false }
      )) as unknown as OfficialBridgeApi['request'];
      renderHook(() => useWatchTask(deps({
        bridge: bridge(request), catalog: catalog(), mainPlaying: true, heartbeatMs: 5_000,
      })));
      await settle();
      await advance(5_000);
      await act(async () => setVisibility('hidden'));
      await advance(30_000);
      const beforeResume = (request as ReturnType<typeof vi.fn>).mock.calls.length;

      await act(async () => setVisibility('visible'));
      expect((request as ReturnType<typeof vi.fn>).mock.calls[beforeResume][0]).toBe('getWatchProgress');
      await advance(5_000);
      expect((request as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe('heartbeat');
    });

    it('halts after three consecutive failures and only restarts through retryHeartbeat', async () => {
      const request = vi.fn(async (action: string) => {
        if (action === 'getWatchProgress') return { accumulatedSeconds: 900, tiers: RAW_TIERS };
        throw new Error('官方心跳暂时不可用');
      }) as unknown as OfficialBridgeApi['request'];
      const { result } = renderHook(() => useWatchTask(deps({
        bridge: bridge(request), catalog: catalog(), mainPlaying: true, heartbeatMs: 5_000,
      })));
      await settle();
      await advance(5_000);
      await advance(5_000);
      await advance(5_000);
      expect(result.current.heartbeatStatus).toBe('error');
      expect(result.current.heartbeatError).toContain('官方心跳暂时不可用');
      const stoppedAt = (request as ReturnType<typeof vi.fn>).mock.calls.length;
      await advance(60_000);
      expect(request).toHaveBeenCalledTimes(stoppedAt);

      act(() => result.current.retryHeartbeat());
      await settle();
      expect((request as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe('getWatchProgress');
      await advance(5_000);
      expect((request as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe('heartbeat');
    });

    it('re-reads all tiers after a heartbeat reports a reward', async () => {
      const request = vi.fn(async (action: string) => (
        action === 'heartbeat'
          ? { accumulatedSeconds: 910, rewarded: true, rewardTier: 3, rewardAmount: 3000 }
          : { accumulatedSeconds: 900, tiers: RAW_TIERS }
      )) as unknown as OfficialBridgeApi['request'];
      renderHook(() => useWatchTask(deps({
        bridge: bridge(request), catalog: catalog(), mainPlaying: true, heartbeatMs: 5_000,
      })));
      await settle();
      await advance(5_000);
      expect((request as ReturnType<typeof vi.fn>).mock.calls
        .filter(([action]) => action === 'getWatchProgress')).toHaveLength(2);
    });

    it('never starts once every reward tier has been granted', async () => {
      const doneTiers = RAW_TIERS.map((tier) => ({ ...tier, granted: true }));
      const request = vi.fn(async () => ({ accumulatedSeconds: 1800, tiers: doneTiers })) as unknown as OfficialBridgeApi['request'];
      const { result } = renderHook(() => useWatchTask(deps({
        bridge: bridge(request), catalog: catalog(), mainPlaying: true, heartbeatMs: 5_000,
      })));
      await settle();
      await advance(30_000);
      expect((request as ReturnType<typeof vi.fn>).mock.calls.some(([action]) => action === 'heartbeat')).toBe(false);
      expect(result.current.heartbeatStatus).toBe('complete');
    });
  });

  describe('enabled', () => {
    it('fetches nothing and returns a stable empty state when disabled (演示模式)', async () => {
      const fetchProgress = vi.fn(async () => PROGRESS);
      const { result } = renderHook(() => useWatchTask(deps({ enabled: false, fetchProgress })));
      await settle();
      vi.advanceTimersByTime(60_000);
      await act(async () => { setVisibility('hidden'); setVisibility('visible'); });
      expect(fetchProgress).not.toHaveBeenCalled();
      expect(result.current.loggedIn).toBe(false);
      expect(result.current.accumulatedSeconds).toBe(0);
      expect(result.current.earnedPellets).toBe(0);
      expect(result.current.tiers).toEqual([]);
    });

    it('empties out when it gets disabled mid-flight', async () => {
      const d = deps();
      const { result, rerender } = renderHook(
        ({ on }) => useWatchTask({ ...d, enabled: on }),
        { initialProps: { on: true } },
      );
      await settle();
      expect(result.current.earnedPellets).toBe(1500);

      rerender({ on: false });
      await settle();
      expect(result.current.loggedIn).toBe(false);
      expect(result.current.earnedPellets).toBe(0);
    });
  });
});
