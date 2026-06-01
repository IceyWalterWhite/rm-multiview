import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCatalog } from './useCatalog';
import { NoLiveZoneError } from '../data/catalog';
import type { ZoneCatalog } from '../types';

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
    let n = 0;
    const fetcher = async () => cat('赛区' + ++n);
    const { result } = renderHook(() => useCatalog(fetcher));
    await waitFor(() => expect(result.current.state).toMatchObject({ catalog: { zoneName: '赛区1' } }));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toMatchObject({ status: 'live', catalog: { zoneName: '赛区2' } });
  });

  it('refresh() finding no live zone flips to ended (terminal)', async () => {
    let n = 0;
    const fetcher = async () => { if (++n === 1) return cat('live'); throw new NoLiveZoneError(); };
    const { result } = renderHook(() => useCatalog(fetcher));
    await waitFor(() => expect(result.current.state.status).toBe('live'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state.status).toBe('ended');
  });

  it('refresh() transient failure keeps the current live catalog (not error)', async () => {
    let n = 0;
    const fetcher = async () => { if (++n === 1) return cat('live'); throw new Error('network down'); };
    const { result } = renderHook(() => useCatalog(fetcher));
    await waitFor(() => expect(result.current.state.status).toBe('live'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toMatchObject({ status: 'live', catalog: { zoneName: 'live' } });
  });
});
