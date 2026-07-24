import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCatalog } from './useCatalog';
import { NoLiveZoneError } from '../data/catalog';
import type { ZoneCatalog } from '../types';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' });
}

const cat = (zoneName: string): ZoneCatalog => ({
  zoneName, chatRoomId: 'r',
  main: { id: 'm', role: '主视角', side: 'main', sources: [] },
  redViews: [], blueViews: [],
});

describe('useCatalog', () => {
  it('loads then exposes the live catalog', async () => {
    const fetcher = async () => cat('北部赛区');
    const { result } = renderHook(() => useCatalog(fetcher));
    await waitFor(() => expect(result.current.state.status).toBe('live'));
    expect(result.current.state).toMatchObject({ status: 'live', catalog: { zoneName: '北部赛区' } });
  });

  it('goes to ended when the initial fetch finds no live zone', async () => {
    const fetcher = async () => { throw new NoLiveZoneError(); };
    const { result } = renderHook(() => useCatalog(fetcher));
    await waitFor(() => expect(result.current.state.status).toBe('ended'));
  });

  it('goes to error on other initial fetch failures', async () => {
    const fetcher = async () => { throw new Error('network down'); };
    const { result } = renderHook(() => useCatalog(fetcher));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });

  it('refresh() swaps in a fresh catalog while staying live', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetcher = async () => cat('赛区' + ++n);
    const { result } = renderHook(() => useCatalog(fetcher));
    await act(async () => {});
    expect(result.current.state).toMatchObject({ catalog: { zoneName: '赛区1' } });
    await act(async () => { vi.advanceTimersByTime(16_000); }); // 越过刷新冷却窗
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toMatchObject({ status: 'live', catalog: { zoneName: '赛区2' } });
  });

  it('refresh() finding no live zone flips to ended (terminal)', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetcher = async () => { if (++n === 1) return cat('live'); throw new NoLiveZoneError(); };
    const { result } = renderHook(() => useCatalog(fetcher));
    await act(async () => {});
    expect(result.current.state.status).toBe('live');
    await act(async () => { vi.advanceTimersByTime(16_000); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state.status).toBe('ended');
  });

  it('refresh() transient failure keeps the current live catalog (not error)', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetcher = async () => { if (++n === 1) return cat('live'); throw new Error('network down'); };
    const { result } = renderHook(() => useCatalog(fetcher));
    await act(async () => {});
    expect(result.current.state.status).toBe('live');
    await act(async () => { vi.advanceTimersByTime(16_000); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toMatchObject({ status: 'live', catalog: { zoneName: 'live' } });
  });

  it('swallows refresh calls within the cooldown window after a successful fetch', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetcher = async () => { calls++; return cat('z' + calls); };
    const { result } = renderHook(() => useCatalog(fetcher));
    await act(async () => {});
    expect(calls).toBe(1);
    // 11 路签名错峰过期：刚换过新签名，几秒内的过期回调都是旧事件，不该再全量重建
    await act(async () => { await result.current.refresh(); });
    expect(calls).toBe(1);
    await act(async () => { vi.advanceTimersByTime(16_000); });
    await act(async () => { await result.current.refresh(); });
    expect(calls).toBe(2);
  });

  describe('ended-state polling (auto-detect stream start)', () => {
    afterEach(() => {
      vi.useRealTimers();
      setHidden(false);
    });

    it('polls while ended and flips to live once a stream appears', async () => {
      vi.useFakeTimers();
      setHidden(false);
      let n = 0;
      const fetcher = async () => { if (++n === 1) throw new NoLiveZoneError(); return cat('回归赛区'); };
      const { result } = renderHook(() => useCatalog(fetcher));
      await act(async () => {}); // 初次 fetch → ended
      expect(result.current.state.status).toBe('ended');

      await act(async () => { vi.advanceTimersByTime(60_000); }); // 轮询 tick
      await act(async () => {}); // refresh promise 落定
      expect(result.current.state).toMatchObject({ status: 'live', catalog: { zoneName: '回归赛区' } });
    });

    it('keeps polling across ticks while no stream appears (ended is no longer terminal)', async () => {
      vi.useFakeTimers();
      setHidden(false);
      let calls = 0;
      const fetcher = async () => { calls++; throw new NoLiveZoneError(); };
      const { result } = renderHook(() => useCatalog(fetcher));
      await act(async () => {});
      expect(result.current.state.status).toBe('ended');
      const initial = calls;

      await act(async () => { vi.advanceTimersByTime(60_000); });
      await act(async () => {});
      await act(async () => { vi.advanceTimersByTime(60_000); });
      await act(async () => {});
      expect(calls).toBe(initial + 2);
      expect(result.current.state.status).toBe('ended');
    });

    it('skips polling while the page is hidden', async () => {
      vi.useFakeTimers();
      setHidden(false);
      let calls = 0;
      const fetcher = async () => { calls++; throw new NoLiveZoneError(); };
      renderHook(() => useCatalog(fetcher));
      await act(async () => {});
      const initial = calls;

      setHidden(true);
      await act(async () => { vi.advanceTimersByTime(180_000); }); // 后台 3 个 tick
      await act(async () => {});
      expect(calls).toBe(initial); // 一次都不该发
    });
  });
});
