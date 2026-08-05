import { describe, it, expect } from 'vitest';
import { readObjectives } from './objectives';
import { fixture } from './__fixtures__/load';

/**
 * 基地与前哨站血量。
 *
 * **当前状态：480p 下尚不可用于生产。** 训练集自测 343/400 = 85.8%
 * （机器人血量在留出集上是 96.0%，可作对比）。这里的字形只有约 4×6px —— 已经在
 * 分辨率极限上，典型错误是 `1500→500`（丢掉细窄的首位）和 `4245→4215`（末两位混淆）。
 *
 * 生产分辨率是 1080p，同一块 ROI 的字形会变成约 9×13px，与让机器人血量做到 96% 的
 * 尺寸相当。所以正确的下一步是**用 1080p 素材重建样本集**，而不是在 480p 上继续调参。
 *
 * 因此本文件只断言那些结构性的、与识别精度无关的性质：读不到时必须返回 null
 * 而不是编一个数、四个字段互相独立、超出量程的读数会被否决。
 */
describe('readObjectives', () => {
  it('never invents a value on a frame that has no scoreboard', () => {
    const blank = { data: new Uint8ClampedArray(852 * 480 * 4), width: 852, height: 480 };
    expect(readObjectives(blank)).toEqual({
      redBase: null,
      redOutpost: null,
      blueBase: null,
      blueOutpost: null,
    });
  });

  it('keeps the four fields independent so one failure cannot drag down the rest', () => {
    const o = readObjectives(fixture('B1Hero', 1400).frame);
    const read = [o.redBase, o.redOutpost, o.blueBase, o.blueOutpost].filter((x) => x !== null);
    expect(read.length).toBeGreaterThan(0);
    for (const field of read) {
      expect(field!.value).toBeGreaterThanOrEqual(0);
      expect(field!.raw).toMatch(/^\d{1,4}$/);
      expect(field!.confidence).toBeGreaterThanOrEqual(0);
      expect(field!.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('reads the red base at full health mid-round', () => {
    // 红方基地是四个字段里最稳的：字号最大、左右装饰已被 ROI 裁掉。
    // 这两帧带完整 ROI 集（只作字形样本的那些帧没抽记分板区域）。
    expect(readObjectives(fixture('B1Hero', 1400).frame).redBase).toMatchObject({ value: 5000 });
    expect(readObjectives(fixture('R1Hero', 1400).frame).redBase).toMatchObject({ value: 5000 });
  });

  it('rejects readings beyond the rulebook ceiling', () => {
    // 基地 5000、前哨站 1500；读出比这还大一定是把别的东西当成了数字
    for (const f of [fixture('B1Hero', 1400), fixture('R1Hero', 1400)]) {
      const o = readObjectives(f.frame);
      if (o.redBase) expect(o.redBase.value).toBeLessThanOrEqual(6000);
      if (o.blueBase) expect(o.blueBase.value).toBeLessThanOrEqual(6000);
      if (o.redOutpost) expect(o.redOutpost.value).toBeLessThanOrEqual(2000);
      if (o.blueOutpost) expect(o.blueOutpost.value).toBeLessThanOrEqual(2000);
    }
  });

  it('does not throw on a frame smaller than the ROIs', () => {
    const tiny = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    expect(() => readObjectives(tiny)).not.toThrow();
  });
});
