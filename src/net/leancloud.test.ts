import { describe, it, expect } from 'vitest';
import { connectDanmaku } from './leancloud';
import type { DanmakuConnection } from './leancloud';

const stubConn = (): DanmakuConnection => ({
  onMessage() {},
  onStatus() {},
  send: async () => ({ id: '', text: '', attrs: {} }),
  close: async () => {},
});

describe('connectDanmaku caching', () => {
  it('reuses an in-flight/successful connection for the same room (single-flight)', async () => {
    let attempts = 0;
    const factory = async () => { attempts++; return stubConn(); };
    const a = await connectDanmaku('room-share', factory);
    const b = await connectDanmaku('room-share', factory);
    expect(a).toBe(b);
    expect(attempts).toBe(1);
  });

  it('evicts a failed connection so the next call retries instead of reusing the rejection', async () => {
    let attempts = 0;
    const factory = async () => {
      attempts++;
      if (attempts === 1) throw new Error('boom');
      return stubConn();
    };
    await expect(connectDanmaku('room-evict', factory)).rejects.toThrow('boom');
    const conn = await connectDanmaku('room-evict', factory); // must retry, not replay the cached rejection
    expect(conn).toBeTruthy();
    expect(attempts).toBe(2);
  });
});
