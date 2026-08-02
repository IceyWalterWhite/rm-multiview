import { describe, it, expect } from 'vitest';
import { decide, RATE_FAST, RATE_SLOW } from './controller';

// error = wall_side − target：正 = 此路画面超前（要等），负 = 落后（要追）
const base = { currentTime: 100, bufferedEnd: 110, adjusting: false };

describe('decide: 死区', () => {
  it('does nothing inside the inner deadband', () => {
    expect(decide({ ...base, error: 0.03 })).toEqual({ type: 'none' });
    expect(decide({ ...base, error: -0.04 })).toEqual({ type: 'none' });
  });

  it('does nothing between inner and outer deadband when not already adjusting', () => {
    expect(decide({ ...base, error: 0.1 })).toEqual({ type: 'none' });
  });

  it('keeps adjusting through the hysteresis band until the inner deadband is reached', () => {
    // 已在变速中，误差 0.1（外死区内、内死区外）→ 继续变速，避免 0.15 边界振荡
    expect(decide({ ...base, error: 0.1, adjusting: true })).toEqual({ type: 'rate', rate: RATE_SLOW });
    expect(decide({ ...base, error: -0.1, adjusting: true })).toEqual({ type: 'rate', rate: RATE_FAST });
    expect(decide({ ...base, error: 0.04, adjusting: true })).toEqual({ type: 'none' });
  });
});

describe('decide: 变速追赶', () => {
  it('slows down when ahead of the target', () => {
    expect(decide({ ...base, error: 1.5 })).toEqual({ type: 'rate', rate: RATE_SLOW });
  });
  it('speeds up when behind the target', () => {
    expect(decide({ ...base, error: -1.5 })).toEqual({ type: 'rate', rate: RATE_FAST });
  });
});

describe('decide: 大误差 seek', () => {
  it('seeks forward when far behind and the buffer holds the target', () => {
    expect(decide({ ...base, error: -5 })).toEqual({ type: 'seek', to: 105 });
  });

  it('seeks partially when the buffer covers only part of the gap', () => {
    // 落后 5s，缓冲只到 +3s → 先跳到缓冲末端留 0.5s 余量
    expect(decide({ ...base, error: -5, bufferedEnd: 103 })).toEqual({ type: 'seek', to: 102.5 });
  });

  it('reports edge when far behind but nothing meaningful is buffered ahead', () => {
    // 该路直播边缘就在眼前：内容还没产出，贴边等待
    expect(decide({ ...base, error: -5, bufferedEnd: 101 })).toEqual({ type: 'edge' });
  });

  it('seeks backward when far ahead', () => {
    expect(decide({ ...base, error: 5 })).toEqual({ type: 'seek', to: 95 });
  });

  it('caps a backward seek at the back-buffer limit', () => {
    // backBufferLength=10，留余量只回退 8s；剩余误差交给后续节拍
    expect(decide({ ...base, error: 12 })).toEqual({ type: 'seek', to: 92 });
  });
});
