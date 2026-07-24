import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

// 弹幕按 FLUSH 窗口批量入 state（高峰期不逐条重渲染），测试统一：
// 先 flush 连接微任务，再推进 fake 时钟越过 flush 窗口。
const flushConnect = () => act(async () => {});
const flushBatch = () => act(() => { vi.advanceTimersByTime(250); });

describe('useDanmaku', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('batches messages arriving within one flush window into a single append', async () => {
    const { conn, emit } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await flushConnect();
    act(() => {
      emit({ id: 'm1', text: 'a', attrs: { position: '队员' } });
      emit({ id: 'm2', text: 'b', attrs: { position: '队员' } });
      emit({ id: 'm3', text: 'c', attrs: { position: '队员' } });
    });
    // flush 窗口内不逐条上屏——高峰期渲染频率被封顶
    expect(result.current.messages.length).toBe(0);
    await flushBatch();
    expect(result.current.messages.map((m) => m.text)).toEqual(['a', 'b', 'c']);
  });

  it('appends incoming messages as Danmaku', async () => {
    const { conn, emit } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await flushConnect();
    expect(result.current.connected).toBe(true);
    act(() => emit({ id: 'm1', text: 'hi', attrs: { nickname: 'n', schoolName: 's', position: '队员', racingAge: 1 } }));
    await flushBatch();
    expect(result.current.messages.at(-1)?.text).toBe('hi');
  });

  it('caps buffer at CHAT_BUFFER_LIMIT even when one batch exceeds it', async () => {
    const { conn, emit } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await flushConnect();
    act(() => { for (let i = 0; i < CHAT_BUFFER_LIMIT + 50; i++) emit({ id: 'm' + i, text: 't' + i, attrs: { position: '队员' } }); });
    await flushBatch();
    expect(result.current.messages.length).toBe(CHAT_BUFFER_LIMIT);
    expect(result.current.messages.at(-1)?.text).toBe('t' + (CHAT_BUFFER_LIMIT + 49));
  });

  it('caps across successive batches', async () => {
    const { conn, emit } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await flushConnect();
    act(() => { for (let i = 0; i < CHAT_BUFFER_LIMIT; i++) emit({ id: 'a' + i, text: 'a' + i, attrs: { position: '队员' } }); });
    await flushBatch();
    act(() => { for (let i = 0; i < 20; i++) emit({ id: 'b' + i, text: 'b' + i, attrs: { position: '队员' } }); });
    await flushBatch();
    expect(result.current.messages.length).toBe(CHAT_BUFFER_LIMIT);
    expect(result.current.messages.at(-1)?.text).toBe('b19');
  });

  it('reflects reconnect lifecycle via status (connected → reconnecting → connected)', async () => {
    const { conn, emitStatus } = fakeConn();
    const connect = async () => conn; // stable ref (mirrors App's memoized connFactory)
    const { result } = renderHook(() => useDanmaku(connect));
    await flushConnect();
    expect(result.current.status).toBe('connected');
    expect(result.current.connected).toBe(true);

    act(() => emitStatus('reconnecting'));
    expect(result.current.status).toBe('reconnecting');
    expect(result.current.connected).toBe(false);

    act(() => emitStatus('connected'));
    expect(result.current.status).toBe('connected');
    expect(result.current.connected).toBe(true);
  });

  it('stops taking messages from a replaced connection (zone switch)', async () => {
    const a = fakeConn();
    const b = fakeConn();
    const connA = async () => a.conn;
    const connB = async () => b.conn;
    const { result, rerender } = renderHook(({ c }) => useDanmaku(c), { initialProps: { c: connA } });
    await flushConnect();
    rerender({ c: connB });
    await flushConnect();
    act(() => a.emit({ id: 'x', text: 'stale', attrs: { position: '队员' } }));
    act(() => b.emit({ id: 'y', text: 'fresh', attrs: { position: '队员' } }));
    await flushBatch();
    expect(result.current.messages.map((m) => m.text)).toEqual(['fresh']);
  });

  it('optimistically inserts sent message', async () => {
    const { conn } = fakeConn();
    const { result } = renderHook(() => useDanmaku(async () => conn));
    await flushConnect();
    await act(async () => { await result.current.send('我发的', { nickname: 'UserA', schoolName: 'A大学', position: '校友', racingAge: 0, badge: '' }); });
    await flushBatch();
    expect(result.current.messages.at(-1)?.text).toBe('我发的');
  });
});
