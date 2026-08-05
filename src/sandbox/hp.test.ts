import { describe, it, expect } from 'vitest';
import { readHp } from './hp';
import { fixture, loadFixtures } from './__fixtures__/load';

/**
 * 注意：glyphs.ts 的模板正是从这批夹具提取的，所以本文件是**回归护栏**而非精度评估 ——
 * 训练集上的正确率说明不了泛化能力。真实精度用留出数据另行评估，
 * 见 tools/sandbox/evaluate.py 与 docs/superpowers/specs 里的验收报告。
 */
describe('readHp', () => {
  it('reads every fixture frame that has a health bar', () => {
    const wrong = loadFixtures()
      .filter((f) => f.hp)
      .map((f) => ({ f, got: readHp(f.frame) }))
      .filter(({ f, got }) => !got || got.current !== f.hp![0] || got.max !== f.hp![1])
      .map(({ f, got }) => `${f.stream}@${f.t}s 期望 ${f.hp![0]}/${f.hp![1]} 实得 ${got ? got.raw : 'null'}`);
    expect(wrong).toEqual([]);
  });

  it('reads a two-digit current value against a three-digit max', () => {
    expect(readHp(fixture('B3Infantry', 1660).frame)).toMatchObject({ current: 40, max: 400 });
  });

  it('reads a nearly empty bar where the backdrop turns dark', () => {
    // 20/200：底条几乎全黑，固定阈值会把白字连同噪点一起收进来
    expect(readHp(fixture('B1Hero', 2200).frame)).toMatchObject({ current: 20, max: 200 });
  });

  it('reads a full bar where the bright team colour sits right under the text', () => {
    expect(readHp(fixture('B1Hero', 1620).frame)).toMatchObject({ current: 200, max: 200 });
  });

  it('reads a frame whose current and max differ in every digit', () => {
    expect(readHp(fixture('R3Infantry', 1500).frame)).toMatchObject({ current: 278, max: 300 });
  });

  it('returns null while the robot is dead and the bar is replaced by the module panel', () => {
    expect(readHp(fixture('B1Hero', 690).frame)).toBeNull();
  });

  it('returns null on the pre-match waiting card', () => {
    expect(readHp(fixture('B1Hero', 300).frame)).toBeNull();
  });

  it('still reads the stream that has no minimap', () => {
    // B2 全场关着小地图，但血条照常渲染 —— 位置与血量必须能各自独立获得
    expect(readHp(fixture('B2SuqqreProject', 1400).frame)).toMatchObject({ current: 250, max: 250 });
  });

  it('reports a confidence for every successful read', () => {
    for (const f of loadFixtures()) {
      const got = readHp(f.frame);
      if (!got) continue;
      expect(got.confidence).toBeGreaterThan(0);
      expect(got.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('rejects a reading whose current value exceeds its max', () => {
    // 分类器偶尔会把某位读错；current>max 是免费的格式校验，宁可不报也不要报错的
    const blank = { data: new Uint8ClampedArray(852 * 480 * 4), width: 852, height: 480 };
    expect(readHp(blank)).toBeNull();
  });

  it('does not throw on a frame smaller than the ROI', () => {
    const tiny = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    expect(() => readHp(tiny)).not.toThrow();
  });
});
