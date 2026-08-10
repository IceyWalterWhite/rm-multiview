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

  // 阈值是可调参数，这里把当前取值（2s）的边界行为钉死：
  // 恰好 2s 仍走变速，越过即改为 seek。±4% 每秒只补 0.04s，2s 已经要追 50s，
  // 再放宽等待时间就长得离谱了。
  it('switches from rate to seek exactly at the 2s threshold', () => {
    expect(decide({ ...base, error: 2 })).toEqual({ type: 'rate', rate: RATE_SLOW });
    expect(decide({ ...base, error: -2 })).toEqual({ type: 'rate', rate: RATE_FAST });
    expect(decide({ ...base, error: 2.01 }).type).toBe('seek');
    expect(decide({ ...base, error: -2.01 }).type).toBe('seek');
  });
});

describe('decide: 大误差 seek', () => {
  it('seeks forward when far behind and the buffer holds the target', () => {
    expect(decide({ ...base, error: -5 })).toEqual({ type: 'seek', to: 105 });
  });

  // 落点不 clamp 进已缓冲区：同步目标恒在 playlist 滑窗内，seek 出缓冲后由
  // hls.js 从落点重新供片。2026-08-07 现网 A/B 对照实测：一步跳出缓冲 47s，
  // 0.2s 恢复播放、seek 1 次；旧逻辑（变速档/clamp 末端−4s）4 次 seek 3.4s 收敛。
  it('seeks straight to the target even when it lies beyond the buffered range', () => {
    expect(decide({ ...base, error: -5, bufferedEnd: 103 })).toEqual({ type: 'seek', to: 105 });
  });

  it('seeks to the exact target instead of stopping short at the buffer edge', () => {
    expect(decide({ ...base, error: -9, bufferedEnd: 112 })).toEqual({ type: 'seek', to: 109 });
  });

  // 后台切前台的恢复路径：暂停几十秒后一次 seek 直达目标，不做旧缓冲内的
  // 分段爬行——爬行正是恢复时长与画面反复跳变的来源
  it('recovers from a long pause with a single seek to the live target', () => {
    expect(decide({ ...base, error: -30, bufferedEnd: 108 })).toEqual({ type: 'seek', to: 130 });
  });

  it('reports edge when far behind but nothing meaningful is buffered ahead', () => {
    // 存粮 <2s = 直播边缘就在眼前、内容还没产出（真断流）：跳无可跳，贴边等待。
    // 2026-08-05 的 seek 死循环护栏也由此承担：落点是固定目标而非缓冲末端，
    // 一跳即达、误差归零，不存在循环的第二跳。
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
