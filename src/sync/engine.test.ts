import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncEngine } from './engine';
import { RATE_SLOW, RATE_FAST } from './controller';

// 结构化假 video：只实现引擎读写的字段
function fakeVideo(ct: number, bufferedAhead = 10, paused = false) {
  return {
    currentTime: ct,
    playbackRate: 1,
    paused,
    buffered: {
      length: 1,
      start: () => Math.max(0, ct - 5),
      end: () => ct + bufferedAhead,
    },
  };
}

// 便捷：注册后喂三个分片样本使 E = epoch（中位数恰为 epoch）
function feed(e: SyncEngine, id: string, epoch: number, ct: number) {
  e.onFrag(id, { wallSec: epoch + ct - 2, fragStart: ct - 2 });
  e.onFrag(id, { wallSec: epoch + ct, fragStart: ct });
  e.onFrag(id, { wallSec: epoch + ct + 2, fragStart: ct + 2 });
}

describe('SyncEngine', () => {
  let e: SyncEngine;
  let main: ReturnType<typeof fakeVideo>;

  beforeEach(() => {
    e = new SyncEngine();
    main = fakeVideo(100);
    e.register('main', { video: main, isMain: true, tier: '1080p' });
    feed(e, 'main', 1000, 100); // wall_main = 1000 + 100 = 1100
  });

  it('slows a side view that runs ahead of main', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1003, 100); // wall = 1103 → error +3
    e.tick();
    expect(side.playbackRate).toBe(RATE_SLOW);
  });

  it('speeds up a side view that lags behind main', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 999, 100); // wall = 1099 → error −1
    e.tick();
    expect(side.playbackRate).toBe(RATE_FAST);
  });

  it('seeks a side view that is far behind and has buffer', () => {
    const side = fakeVideo(100, 10);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 994, 100); // error −6 → seek 到 106
    e.tick();
    expect(side.currentTime).toBe(106);
  });

  it('applies the 540p tier prior so a transcode-late name clock reads as synced', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '540p' });
    // 名字钟晚标 3.94s：E = 1003.94 → 未修正 error = +3.94；tier 先验修正后 ≈ 0
    e.onFrag('s1', { wallSec: 1104, fragStart: 100.06 });
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('applies per-view delta set by calibration', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1002, 100); // error +2 → 本应减速
    e.setDelta('s1', 2); // 校准表明这 2 秒是名字钟常量偏差，非真实超前
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('does nothing without a main reference', () => {
    const e2 = new SyncEngine();
    const side = fakeVideo(100);
    e2.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e2, 's1', 1003, 100);
    e2.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('skips paused streams (backgrounded side views)', () => {
    const side = fakeVideo(100, 10, true);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1003, 100);
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('resets rates and stops acting when disabled', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1003, 100);
    e.tick();
    expect(side.playbackRate).toBe(RATE_SLOW);
    e.setEnabled(false);
    expect(side.playbackRate).toBe(1);
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('unregister restores rate and removes the stream', () => {
    const side = fakeVideo(100);
    const unreg = e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1003, 100);
    e.tick();
    expect(side.playbackRate).toBe(RATE_SLOW);
    unreg();
    expect(side.playbackRate).toBe(1);
    feed(e, 's1', 1003, 100); // 已注销：样本被忽略
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('applies the global trim to the comparison', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1001, 100); // error +1
    e.setTrim(1); // 用户手动声明这 1 秒是系统性偏差
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('forwards teed bytes with url and stream handle to the byte sink', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '540p' });
    const sink = vi.fn();
    e.setByteSink(sink);
    const buf = new ArrayBuffer(4);
    e.pushBytes('s1', buf, 'https://x/a/1785593205_9.ts');
    expect(sink).toHaveBeenCalledWith(
      's1',
      buf,
      'https://x/a/1785593205_9.ts',
      expect.objectContaining({ isMain: false, tier: '540p' }),
    );
  });

  it('drops teed bytes for unregistered streams', () => {
    const sink = vi.fn();
    e.setByteSink(sink);
    e.pushBytes('ghost', new ArrayBuffer(4), 'u');
    expect(sink).not.toHaveBeenCalled();
  });

  it('keeps statusOf reference stable across ticks when nothing changed', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 999, 100);
    e.tick();
    const a = e.statusOf('s1');
    e.tick(); // 同样的误差（假 video 不动）→ 引用必须不变，否则 1Hz 击穿 memo
    expect(e.statusOf('s1')).toBe(a);
    expect(a.mode).toBe('adjusting');
  });

  it('replaces the statusOf reference when the mode or rounded error changes', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 999, 100);
    e.tick();
    const a = e.statusOf('s1');
    side.currentTime = 100.9; // 误差 −1 → −0.1（追上了）
    e.tick();
    expect(e.statusOf('s1')).not.toBe(a);
  });

  it('reports an off status for unknown streams', () => {
    expect(e.statusOf('nope').mode).toBe('off');
  });

  it('notifies change listeners only when some status actually changed', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 999, 100);
    const onChange = vi.fn();
    e.subscribeChange(onChange);
    e.tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    e.tick(); // 状态没变 → 不再通知
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers with per-stream status after each tick', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 999, 100);
    const seen: unknown[] = [];
    const unsub = e.subscribe((s) => seen.push(s));
    e.tick();
    unsub();
    expect(seen.length).toBe(1);
    const statuses = seen[0] as Map<string, { error: number | null; mode: string }>;
    expect(statuses.get('s1')?.mode).toBe('adjusting');
    expect(statuses.get('s1')?.error).toBeCloseTo(-1, 3);
  });
});
