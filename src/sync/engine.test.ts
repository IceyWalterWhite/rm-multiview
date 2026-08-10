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

function measured(
  e: SyncEngine,
  id: string,
  offset = 0,
  sideTier = '1080p',
  mainRef = 'main|1080p',
) {
  e.setOffset(id, offset, { mainRef, sideTier });
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

  it('leaves an unmeasured side stream untouched and reports it as off', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '540p' });
    feed(e, 's1', 1001.5, 100); // 若擅自猜 offset，会对此路变速或 seek

    e.tick();

    expect(side.currentTime).toBe(100);
    expect(side.playbackRate).toBe(1);
    expect(e.statusOf('s1')).toEqual({ error: null, mode: 'off' });
  });

  it('uses a measured offset only for the matching side resolution', () => {
    const side540 = fakeVideo(100);
    e.register('s1', { video: side540, isMain: false, tier: '540p' });
    feed(e, 's1', 1002.5, 100);
    measured(e, 's1', 2.5, '540p');
    e.tick();
    expect(e.offsetOf('s1')).toBe(2.5);
    expect(e.statusOf('s1').mode).toBe('synced');

    const side720 = fakeVideo(100);
    e.register('s1', { video: side720, isMain: false, tier: '720p' });
    feed(e, 's1', 1002.5, 100);
    e.tick();

    expect(e.offsetOf('s1')).toBeUndefined();
    expect(e.statusOf('s1')).toEqual({ error: null, mode: 'off' });
    expect(side720.currentTime).toBe(100);
  });

  it('keeps profiles for other main resolutions and reuses them when the metadata matches again', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '540p' });
    feed(e, 's1', 1002.5, 100);
    measured(e, 's1', 2.5, '540p', 'main|1080p');
    e.tick();
    expect(e.offsetOf('s1')).toBe(2.5);

    e.register('main', { video: main, isMain: true, tier: '720p' });
    feed(e, 'main', 1000, 100);
    e.tick();
    expect(e.offsetOf('s1')).toBeUndefined();
    expect(e.statusOf('s1').mode).toBe('off');

    e.register('main', { video: main, isMain: true, tier: '1080p' });
    feed(e, 'main', 1000, 100);
    e.tick();
    expect(e.offsetOf('s1')).toBe(2.5);
    expect(e.statusOf('s1').mode).toBe('synced');
  });

  it('slows a side view that runs ahead of main', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1001.5, 100);
    measured(e, 's1'); // wall = 1101.5 → error +1.5，在 seek 阈值内 → 走变速
    e.tick();
    expect(side.playbackRate).toBe(RATE_SLOW);
  });

  it('speeds up a side view that lags behind main', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 999, 100);
    measured(e, 's1'); // wall = 1099 → error −1
    e.tick();
    expect(side.playbackRate).toBe(RATE_FAST);
  });

  it('seeks a side view that is far behind and has buffer', () => {
    const side = fakeVideo(100, 10);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 994, 100);
    measured(e, 's1'); // error −6 → seek 到 106
    e.tick();
    expect(side.currentTime).toBe(106);
  });

  describe('offset profile metadata', () => {
    it('does not use a profile after the main view identity changes', () => {
      const side = fakeVideo(100);
      e.register('s1', { video: side, isMain: false, tier: '1080p' });
      feed(e, 's1', 1002.5, 100);
      measured(e, 's1', 2.5);
      e.tick();
      expect(e.offsetOf('s1')).toBe(2.5);

      e.register('main', { video: main, isMain: false, tier: '1080p' });
      e.register('other-main', { video: main, isMain: true, tier: '1080p' });
      feed(e, 'other-main', 1000, 100);
      e.tick();

      expect(e.offsetOf('s1')).toBeUndefined();
      expect(e.statusOf('s1')).toEqual({ error: null, mode: 'off' });
    });

    it('restores profiles before registration but exposes one only after all metadata matches', () => {
      const e2 = new SyncEngine();
      e2.restoreOffsets({ 'main|1080p': { s1: { '540p': 2.5 } } });
      e2.tick();
      expect(e2.offsetOf('s1')).toBeUndefined();

      const restoredMain = fakeVideo(100);
      const restoredSide = fakeVideo(100);
      e2.register('main', { video: restoredMain, isMain: true, tier: '1080p' });
      e2.register('s1', { video: restoredSide, isMain: false, tier: '540p' });
      feed(e2, 'main', 1000, 100);
      feed(e2, 's1', 1002.5, 100);
      e2.tick();

      expect(e2.offsetOf('s1')).toBe(2.5);
      expect(e2.statusOf('s1').mode).toBe('synced');
    });
  });

  it('applies per-view delta set by calibration', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1002, 100); // error +2 → 本应减速
    measured(e, 's1', 2); // 校准表明这 2 秒是名字钟常量偏差，非真实超前
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('does nothing without a main reference', () => {
    const e2 = new SyncEngine();
    const side = fakeVideo(100);
    e2.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e2, 's1', 1003, 100);
    measured(e2, 's1');
    e2.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('skips paused streams (backgrounded side views)', () => {
    const side = fakeVideo(100, 10, true);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1003, 100);
    measured(e, 's1');
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('resets rates and stops acting when disabled', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1001.5, 100);
    measured(e, 's1'); // 阈值内 → 变速（本用例要验的是关闭后倍速归 1）
    e.tick();
    expect(side.playbackRate).toBe(RATE_SLOW);
    e.setEnabled(false);
    expect(side.playbackRate).toBe(1);
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  // 关掉后 tick 直接 return，若不主动清缓存，角标会永远定格在关闭那一刻的读数
  // （2026-08-05 现网实测：关闭后 8 个角标 30 秒纹丝不动）
  it('clears cached statuses when disabled so badges cannot freeze on screen', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1003, 100);
    measured(e, 's1');
    e.tick();
    expect(e.statusOf('s1').mode).toBe('adjusting');

    let notified = 0;
    e.subscribeChange(() => notified++);
    e.setEnabled(false);

    expect(e.statusOf('s1').mode).toBe('off');
    expect(e.statusOf('main').mode).toBe('off');
    expect(notified).toBe(1); // 必须通知订阅者，否则 UI 不会重渲染
  });

  it('does not re-notify when disabling twice or when nothing was cached', () => {
    let notified = 0;
    e.subscribeChange(() => notified++);
    e.setEnabled(false); // 从未 tick 过，缓存本就是空的
    expect(notified).toBe(0);
    e.setEnabled(false); // 重复关闭是 no-op
    expect(notified).toBe(0);
  });

  it('unregister restores rate and removes the stream', () => {
    const side = fakeVideo(100);
    const unreg = e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1001.5, 100);
    measured(e, 's1'); // 阈值内 → 变速（本用例要验的是注销后倍速归 1）
    e.tick();
    expect(side.playbackRate).toBe(RATE_SLOW);
    unreg();
    expect(side.playbackRate).toBe(1);
    feed(e, 's1', 1001.5, 100); // 已注销：样本被忽略
    e.tick();
    expect(side.playbackRate).toBe(1);
  });

  it('applies the global trim to the comparison', () => {
    const side = fakeVideo(100);
    e.register('s1', { video: side, isMain: false, tier: '1080p' });
    feed(e, 's1', 1001, 100);
    measured(e, 's1'); // error +1
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
    measured(e, 's1');
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
    measured(e, 's1');
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
    measured(e, 's1');
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
    measured(e, 's1');
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
