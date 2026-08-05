import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCheer, type CheerDeps } from './useCheer';
import { CheerProxyError } from '../data/cheer';
import { RM_OFFICIAL_LIVE_URL } from '../config';
import type { CheerInfo, CheerTarget, ZoneCatalog } from '../types';
import { OfficialBridgeError } from '../net/officialBridge';
import type { OfficialBridgeApi } from './useOfficialBridge';

const TARGET: CheerTarget = {
  matchId: '31228', redTeamId: '3059', blueTeamId: '739',
  redLabel: 'A大学 Alpha', blueLabel: 'B大学 Beta',
};
const INFO: CheerInfo = { redVotes: 2628, blueVotes: 2397, voteEnabled: true };

const catalog = (over: Partial<ZoneCatalog> = {}): ZoneCatalog => ({
  zoneName: '北部赛区', chatRoomId: 'r',
  main: { id: 'm', role: '主视角', side: 'main', sources: [] },
  redViews: [], blueViews: [],
  zoneId: '617', liveState: 1, matchState: 1, openVote: 1,
  ...over,
});

// deps 必须是稳定引用（每个用例建一次），否则轮询会在每次渲染重启
const deps = (over: Partial<CheerDeps> = {}): CheerDeps => ({
  fetchTarget: async () => TARGET,
  fetchInfo: async () => INFO,
  ...over,
});

const bridge = (over: Partial<OfficialBridgeApi> = {}): OfficialBridgeApi => ({
  status: 'ready',
  request: vi.fn(async () => ({ redVotes: 2628, blueVotes: 2397, voteEnabled: true })),
  retry: vi.fn(async () => {}),
  ...over,
});

const settle = () => act(async () => {});
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

describe('useCheer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('hides itself when the zone has no current match', async () => {
    const { result } = renderHook(() => useCheer(catalog(), deps({ fetchTarget: async () => null })));
    await settle();
    expect(result.current.visible).toBe(false);
    expect(result.current.canVote).toBe(false);
  });

  it('shows a read-only popularity bar once the votes arrive', async () => {
    const { result } = renderHook(() => useCheer(catalog(), deps()));
    await settle();
    expect(result.current.visible).toBe(true);
    expect(result.current.redVotes).toBe(2628);
    expect(result.current.blueVotes).toBe(2397);
    expect(result.current.redLabel).toBe('A大学 Alpha');
    expect(result.current.blueLabel).toBe('B大学 Beta');
  });

  it('only allows voting when every official and runtime gate is open', async () => {
    const ready = bridge();
    const { result, rerender } = renderHook(
      ({ c, loggedIn }) => useCheer(c, deps({ bridge: ready, loggedIn })),
      { initialProps: { c: catalog(), loggedIn: true } },
    );
    await settle();
    expect(result.current.canVote).toBe(true);
    expect(result.current.officialUrl).toBe('https://www.robomaster.com/live');

    // openVote 是官方 PC 前端自己的显示开关，不等于投票通道关闭：2026-08-05 全国赛决赛期间
    // 实测 openVote=0 而 cheer/info 的 voteEnabled=true，票数每 10 秒真实增长数十票。
    // 能不能投以接口的答复为准，见下一个用例。
    rerender({ c: catalog({ openVote: 0 }), loggedIn: true });
    expect(result.current.canVote).toBe(true);
    rerender({ c: catalog({ matchState: 0 }), loggedIn: true });
    expect(result.current.canVote).toBe(false);
    rerender({ c: catalog({ liveState: 0 }), loggedIn: true });
    expect(result.current.canVote).toBe(false);
    rerender({ c: catalog(), loggedIn: false });
    expect(result.current.canVote).toBe(false);
  });

  it('refuses to vote when the official endpoint itself reports voting closed', async () => {
    // voteEnabled 是唯一权威：官方前端开关开着也压不过接口说「这场不接受投票」。
    const { result } = renderHook(() => useCheer(catalog({ openVote: 1 }), deps({
      bridge: bridge(),
      loggedIn: true,
      fetchInfo: async () => ({ ...INFO, voteEnabled: false }),
    })));
    await settle();
    expect(result.current.visible).toBe(true);
    expect(result.current.canVote).toBe(false);
  });

  it('optimistically aggregates a side for five seconds and adopts official totals', async () => {
    const request = vi.fn(async () => ({ redVotes: 2700, blueVotes: 2400, voteEnabled: true }));
    const { result } = renderHook(() => useCheer(catalog(), deps({
      bridge: bridge({ request }), loggedIn: true, voteFlushMs: 5_000,
    })));
    await settle();

    act(() => { result.current.vote('red'); result.current.vote('red'); });
    expect(result.current.redVotes).toBe(2630);
    expect(request).not.toHaveBeenCalled();
    await advance(4_999);
    expect(request).not.toHaveBeenCalled();
    await advance(1);
    expect(request).toHaveBeenCalledWith('vote', { matchId: '31228', teamId: '3059', count: 2 });
    expect(result.current.redVotes).toBe(2700);
    expect(result.current.blueVotes).toBe(2400);
  });

  it('flushes red and blue vote batches independently', async () => {
    const request = vi.fn(async () => ({ redVotes: 2700, blueVotes: 2500, voteEnabled: true }));
    const { result } = renderHook(() => useCheer(catalog(), deps({
      bridge: bridge({ request }), loggedIn: true, voteFlushMs: 5_000,
    })));
    await settle();
    act(() => { result.current.vote('red'); result.current.vote('blue'); });
    await advance(5_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('vote', { matchId: '31228', teamId: '3059', count: 1 });
    expect(request).toHaveBeenCalledWith('vote', { matchId: '31228', teamId: '739', count: 1 });
  });

  it('rolls an optimistic vote back to freshly read totals after an official failure', async () => {
    let reads = 0;
    const fetchInfo = vi.fn(async () => (reads++ === 0 ? INFO : {
      redVotes: 2600, blueVotes: 2300, voteEnabled: true,
    }));
    const request = vi.fn(async () => {
      throw new OfficialBridgeError('请先登录 RoboMaster', 'B200000');
    });
    const { result } = renderHook(() => useCheer(catalog(), deps({
      fetchInfo, bridge: bridge({ request }), loggedIn: true, voteFlushMs: 5_000,
    })));
    await settle();
    act(() => result.current.vote('blue'));
    expect(result.current.blueVotes).toBe(2398);
    await advance(5_000);
    expect(result.current.redVotes).toBe(2600);
    expect(result.current.blueVotes).toBe(2300);
    expect(result.current.error).toContain('请先登录 RoboMaster');
  });

  it('stays invisible until the first read succeeds (有 currentMatch 也不空显示)', async () => {
    const { result } = renderHook(() => useCheer(catalog(), deps({
      fetchInfo: async () => { throw new Error('network down'); },
    })));
    await settle();
    expect(result.current.visible).toBe(false);
    expect(result.current.redVotes).toBe(0);
  });

  it('polls the votes on its own interval', async () => {
    let n = 0;
    const fetchInfo = vi.fn(async () => ({ redVotes: 100 + ++n, blueVotes: 0, voteEnabled: true }));
    const { result } = renderHook(() => useCheer(catalog(), deps({ fetchInfo, infoPollMs: 10_000 })));
    await settle();
    expect(result.current.redVotes).toBe(101);
    await advance(10_000);
    expect(result.current.redVotes).toBe(102);
  });

  it('does not restart the vote poll when the same match is re-fetched', async () => {
    const fetchTarget = vi.fn(async () => ({ ...TARGET })); // 每轮都是新对象
    const fetchInfo = vi.fn(async () => INFO);
    renderHook(() => useCheer(catalog(), deps({ fetchTarget, fetchInfo, targetPollMs: 20_000, infoPollMs: 10_000 })));
    await settle();
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    await advance(20_000);
    // 只该是两次定时轮询；身份不稳就会因 effect 重启多出一次立即拉取
    expect(fetchInfo).toHaveBeenCalledTimes(3);
  });

  it('clears the previous match votes when the match changes', async () => {
    let first = true;
    const fetchTarget = vi.fn(async () => {
      if (first) { first = false; return TARGET; }
      return { ...TARGET, matchId: '31229', redLabel: 'C大学 Gamma' };
    });
    const fetchInfo = vi.fn(async (t: CheerTarget) =>
      (t.matchId === '31228' ? INFO : { redVotes: 5, blueVotes: 6, voteEnabled: true }));
    const { result } = renderHook(() => useCheer(catalog(), deps({ fetchTarget, fetchInfo, targetPollMs: 20_000 })));
    await settle();
    expect(result.current.redVotes).toBe(2628);
    await advance(20_000);
    expect(result.current.redVotes).toBe(5);
    expect(result.current.redLabel).toBe('C大学 Gamma');
  });

  it('keeps the last good votes when a read fails (比赛间隙不闪)', async () => {
    let n = 0;
    const fetchInfo = vi.fn(async () => {
      if (++n > 1) throw new Error('network down');
      return INFO;
    });
    const { result } = renderHook(() => useCheer(catalog(), deps({ fetchInfo, infoPollMs: 10_000 })));
    await settle();
    await advance(10_000);
    expect(result.current.redVotes).toBe(2628);
    expect(result.current.visible).toBe(true);
    expect(result.current.error).toBe('人气值暂时读不到');
  });

  it('gives up quietly when the proxy is missing (本地 dev / 未部署 → 404)', async () => {
    const fetchInfo = vi.fn(async () => { throw new CheerProxyError(404); });
    const { result } = renderHook(() => useCheer(catalog(), deps({ fetchInfo, infoPollMs: 10_000 })));
    await settle();
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(fetchInfo).toHaveBeenCalledTimes(1); // 不再重试
    expect(result.current.visible).toBe(false);
    expect(result.current.error).toBeNull();    // 也不报错，安静降级
  });

  it('fetches nothing at all when disabled (演示模式)', async () => {
    const fetchTarget = vi.fn(async () => TARGET);
    const fetchInfo = vi.fn(async () => INFO);
    const { result } = renderHook(() => useCheer(catalog(), deps({ enabled: false, fetchTarget, fetchInfo })));
    await settle();
    await advance(60_000);
    expect(fetchTarget).not.toHaveBeenCalled();
    expect(fetchInfo).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      redVotes: 0, blueVotes: 0, redLabel: '', blueLabel: '',
      canVote: false, vote: expect.any(Function), visible: false,
      officialUrl: RM_OFFICIAL_LIVE_URL, error: null,
    });
  });

  it('stops fetching and empties out when it gets disabled mid-flight', async () => {
    const fetchInfo = vi.fn(async () => INFO);
    const d = deps({ fetchInfo, infoPollMs: 10_000 });
    const { result, rerender } = renderHook(
      ({ on }) => useCheer(catalog(), { ...d, enabled: on }),
      { initialProps: { on: true } },
    );
    await settle();
    expect(result.current.visible).toBe(true);
    const calls = fetchInfo.mock.calls.length;

    rerender({ on: false });
    await advance(60_000);
    expect(fetchInfo).toHaveBeenCalledTimes(calls);
    expect(result.current.visible).toBe(false);
    expect(result.current.redVotes).toBe(0);
  });
});
