import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheerInfo, CheerTarget, ZoneCatalog } from '../types';
import { CheerProxyError } from '../data/cheer';
import { useCheer, type CheerDeps } from './useCheer';

const target: CheerTarget = {
  matchId: '31228', redTeamId: '3059', blueTeamId: '739',
  redLabel: 'A大学 Alpha', blueLabel: 'B大学 Beta',
};
const info: CheerInfo = { redVotes: 2628, blueVotes: 2397 };
const catalog = (zoneName = '北部赛区'): ZoneCatalog => ({
  zoneName,
  chatRoomId: '',
  main: { id: 'main', role: '主视角', side: 'main', sources: [] },
  redViews: [],
  blueViews: [],
});
const deps = (overrides: Partial<CheerDeps> = {}): CheerDeps => ({
  fetchTarget: async () => target,
  fetchInfo: async () => info,
  targetPollMs: 20_000,
  infoPollMs: 10_000,
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('useCheer', () => {
  it('shows official labels and totals only after the first successful read', async () => {
    let resolveInfo: (value: CheerInfo) => void = () => {};
    const pending = new Promise<CheerInfo>((resolve) => { resolveInfo = resolve; });
    const { result } = renderHook(() => useCheer(catalog(), deps({ fetchInfo: () => pending })));

    await waitFor(() => expect(result.current.redLabel).toBe('A大学 Alpha'));
    expect(result.current.visible).toBe(false);

    resolveInfo(info);
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current).toMatchObject({ redVotes: 2628, blueVotes: 2397 });
  });

  it('stays hidden when there is no current match', async () => {
    const fetchTarget = vi.fn(async () => null);
    const fetchInfo = vi.fn(async () => info);
    const { result } = renderHook(() => useCheer(catalog(), deps({
      fetchTarget,
      fetchInfo,
    })));

    await waitFor(() => expect(fetchTarget).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
    expect(fetchInfo).not.toHaveBeenCalled();
  });

  it('switches labels and clears old totals when the current match changes', async () => {
    const second = { ...target, matchId: '40000', redLabel: 'C大学 Gamma', blueLabel: 'D大学 Delta' };
    const fetchTarget = vi.fn(async (zoneName: string) => zoneName === '北部赛区' ? target : second);
    const fetchInfo = vi.fn(async (value: CheerTarget) => value.matchId === target.matchId
      ? info
      : { redVotes: 5, blueVotes: 6 });
    const { result, rerender } = renderHook(
      ({ zone }) => useCheer(catalog(zone), deps({ fetchTarget, fetchInfo })),
      { initialProps: { zone: '北部赛区' } },
    );

    await waitFor(() => expect(result.current.redVotes).toBe(2628));
    rerender({ zone: '东部赛区' });
    expect(result.current.visible).toBe(false);
    expect(result.current.redVotes).toBe(0);
    await waitFor(() => expect(result.current.redLabel).toBe('C大学 Gamma'));
    await waitFor(() => expect(result.current.redVotes).toBe(5));
  });

  it('keeps the last good totals when a later poll fails', async () => {
    const fetchInfo = vi.fn<() => Promise<CheerInfo>>()
      .mockResolvedValueOnce(info)
      .mockRejectedValue(new Error('temporary'));
    const { result } = renderHook(() => useCheer(catalog(), deps({ fetchInfo, infoPollMs: 15 })));

    await waitFor(() => expect(result.current.visible).toBe(true));
    await waitFor(() => expect(fetchInfo.mock.calls.length).toBeGreaterThan(1));
    expect(result.current).toMatchObject({ redVotes: 2628, blueVotes: 2397, visible: true });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it('stops retrying and stays hidden when the proxy is not deployed', async () => {
    const fetchInfo = vi.fn(async () => { throw new CheerProxyError(404); });
    const { result } = renderHook(() => useCheer(catalog(), deps({ fetchInfo, infoPollMs: 15 })));

    await waitFor(() => expect(fetchInfo).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    expect(result.current.visible).toBe(false);
  });

  it('pauses polling in the background and resumes both reads in the foreground', async () => {
    let hidden = true;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const fetchTarget = vi.fn(async () => target);
    const fetchInfo = vi.fn(async () => info);
    renderHook(() => useCheer(catalog(), deps({
      fetchTarget,
      fetchInfo,
      targetPollMs: 10,
      infoPollMs: 10,
    })));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchTarget).not.toHaveBeenCalled();
    expect(fetchInfo).not.toHaveBeenCalled();

    hidden = false;
    await waitFor(() => expect(fetchTarget).toHaveBeenCalled());
    await waitFor(() => expect(fetchInfo).toHaveBeenCalled());
    const firstInfoReads = fetchInfo.mock.calls.length;
    await waitFor(() => expect(fetchInfo.mock.calls.length).toBeGreaterThan(firstInfoReads));
  });
});
