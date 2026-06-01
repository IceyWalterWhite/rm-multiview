import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDanmaku } from './useDanmaku';
import type { DanmakuConnection, DanmakuStatus, RawMessage } from '../net/leancloud';
import { CHAT_BUFFER_LIMIT } from '../config';

function fakeConn() {
  let cb: ((m: RawMessage) => void) | null = null;
  let statusCb: ((s: DanmakuStatus) => void) | null = null;
  const conn: DanmakuConnection = {
    onMessage: (f) => { cb = f; },
    onStatus: (f) => { statusCb = f; },
    send: async (text, p) => ({ id: 'local-' + text, text, attrs: { nickname: p.nickname, schoolName: p.schoolName, position: p.position, racingAge: p.racingAge, badge: p.badge } }),
    close: async () => {},
  };
  return { conn, emit: (m: RawMessage) => cb?.(m), emitStatus: (s: DanmakuStatus) => statusCb?.(s) };
}

describe('useDanmaku', () => {
  it('appends incoming messages as Danmaku', async () => {
    const { conn, emit } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await waitFor(() => expect(result.current.connected).toBe(true));
    act(() => emit({ id: 'm1', text: 'hi', attrs: { nickname: 'n', schoolName: 's', position: '队员', racingAge: 1 } }));
    expect(result.current.messages.at(-1)?.text).toBe('hi');
  });

  it('caps buffer at CHAT_BUFFER_LIMIT', async () => {
    const { conn, emit } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await waitFor(() => expect(result.current.connected).toBe(true));
    act(() => { for (let i = 0; i < CHAT_BUFFER_LIMIT + 50; i++) emit({ id: 'm' + i, text: 't' + i, attrs: { position: '队员' } }); });
    expect(result.current.messages.length).toBe(CHAT_BUFFER_LIMIT);
  });

  it('reflects reconnect lifecycle via status (connected → reconnecting → connected)', async () => {
    const { conn, emitStatus } = fakeConn();
    const connect = async () => conn; // stable ref (mirrors App's memoized connFactory)
    const { result } = renderHook(() => useDanmaku(connect));
    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(result.current.connected).toBe(true);

    act(() => emitStatus('reconnecting'));
    expect(result.current.status).toBe('reconnecting');
    expect(result.current.connected).toBe(false);

    act(() => emitStatus('connected'));
    expect(result.current.status).toBe('connected');
    expect(result.current.connected).toBe(true);
  });

  it('optimistically inserts sent message', async () => {
    const { conn } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await waitFor(() => expect(result.current.connected).toBe(true));
    await act(async () => { await result.current.send('我发的', { nickname: 'UserA', schoolName: 'A大学', position: '校友', racingAge: 0, badge: '' }); });
    expect(result.current.messages.at(-1)?.text).toBe('我发的');
  });
});
