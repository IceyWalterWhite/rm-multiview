import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMatchTitle } from './useMatchTitle';
import type { MatchTitle } from '../types';

const T = (text: string, isNext = false): MatchTitle => ({ text, isNext });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('useMatchTitle', () => {
  it('fetches the title on mount', async () => {
    const fetcher = async () => T('超级对抗赛 北部赛区 第68场 A大学 Alpha vs B大学 Beta');
    const { result } = renderHook(() => useMatchTitle('北部赛区', fetcher, 20000));
    await waitFor(() => expect(result.current?.text).toContain('第68场'));
    expect(result.current?.isNext).toBe(false);
  });

  it('keeps the last good value when a later poll throws', async () => {
    let n = 0;
    const fetcher = async () => { if (++n === 1) return T('A'); throw new Error('net'); };
    const { result } = renderHook(() => useMatchTitle('z', fetcher, 10));
    await waitFor(() => expect(result.current?.text).toBe('A'));
    await sleep(60); // 多次轮询都抛错
    expect(result.current?.text).toBe('A');
  });

  it('resolves null and stays null when fetcher returns null', async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return null; };
    const { result } = renderHook(() => useMatchTitle('z', fetcher, 10000));
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    expect(result.current).toBeNull();
  });
});
