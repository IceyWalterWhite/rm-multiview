import { describe, it, expect } from 'vitest';
import { createObjectiveFusion } from './objectiveFusion';
import type { Objectives } from './objectives';

const hp = (value: number, confidence: number) => ({ value, confidence, raw: String(value) });
/** 只关心 redBase 的场景，其余三个字段留空 */
const only = (v: { value: number; confidence: number } | null): Objectives => ({
  redBase: v ? hp(v.value, v.confidence) : null,
  redOutpost: null,
  blueBase: null,
  blueOutpost: null,
});
const many = (v: number, conf: number, n: number) =>
  Array.from({ length: n }, () => only({ value: v, confidence: conf }));

describe('createObjectiveFusion', () => {
  it('高置信度的少数派压得过低置信度的多数派', () => {
    // 现网原型：真值 3946 置信度 0.30~0.39 只有两三路读到，
    // 误读 3936（只差一位数字）置信度 0.05~0.17 却有四五路。等权众数会选错。
    const f = createObjectiveFusion();
    const out = f.observe([
      only({ value: 3946, confidence: 0.35 }),
      only({ value: 3946, confidence: 0.32 }),
      ...many(3936, 0.12, 4),
    ]);
    expect(out.redBase).toBe(3946);
  });

  it('扛得住连续多拍的全员误读 —— 十路是相关的，时间才是独立轴', () => {
    // 这是现网实测出的失效模式：t=7~9 连续三拍八路全部读出 3936，
    // 而 3946 在前后时刻以 0.3+ 反复出现。逐拍投票会翻车，时间累积不会。
    const f = createObjectiveFusion();
    for (let i = 0; i < 5; i++) {
      f.observe([...many(3946, 0.34, 3), ...many(3936, 0.09, 5)]);
    }
    expect(f.state.redBase).toBe(3946);
    for (let i = 0; i < 3; i++) f.observe(many(3936, 0.09, 8)); // 全员误读三拍
    expect(f.state.redBase).toBe(3946); // 没被翻动
  });

  it('置信度低于下限的读数连入账资格都没有', () => {
    const f = createObjectiveFusion();
    for (let i = 0; i < 3; i++) {
      f.observe([only({ value: 5000, confidence: 0.3 }), ...many(1234, 0.04, 6)]);
    }
    expect(f.state.redBase).toBe(5000);
  });

  it('开局证据不足时先空着，不急着落定', () => {
    // 单调约束会把开局的偶然永久锁死，所以宁可等
    const f = createObjectiveFusion();
    expect(f.observe([only({ value: 3396, confidence: 0.09 })]).redBase).toBeNull();
    // 出现一组强读数才落定
    expect(f.observe(many(3946, 0.35, 3)).redBase).toBe(3946);
  });

  it('上跳一律否掉 —— 回合内战略目标不回血', () => {
    const f = createObjectiveFusion();
    for (let i = 0; i < 5; i++) f.observe(many(4000, 0.4, 3));
    for (let i = 0; i < 5; i++) f.observe(many(4500, 0.9, 3));
    expect(f.state.redBase).toBe(4000); // 置信度再高、持续再久也不认
  });

  it('真实掉血会跟上，只是要攒够证据', () => {
    const f = createObjectiveFusion();
    for (let i = 0; i < 10; i++) f.observe(many(4000, 0.4, 3));
    expect(f.state.redBase).toBe(4000);
    let ticks = 0;
    while (f.state.redBase !== 3900 && ticks < 30) {
      f.observe(many(3900, 0.4, 3));
      ticks++;
    }
    expect(f.state.redBase).toBe(3900);
    // 衰减 0.9 时理论上约 6.6 拍反超；留出余量但必须是「拍」的量级，不能拖到几十拍
    expect(ticks).toBeLessThanOrEqual(12);
  });

  it('本轮谁也没读出来时保持上一个值', () => {
    // 战略目标不会因为没人看见就消失
    const f = createObjectiveFusion();
    for (let i = 0; i < 5; i++) f.observe(many(4000, 0.4, 3));
    expect(f.observe([only(null), only(null)]).redBase).toBe(4000);
  });

  it('回合重置后重新接受满血', () => {
    // 目标血量每回合归满；不清状态的话新回合的满血会被当成上跳否掉
    const f = createObjectiveFusion();
    for (let i = 0; i < 5; i++) f.observe(many(600, 0.4, 3));
    f.reset();
    expect(f.observe(many(5000, 0.4, 3)).redBase).toBe(5000);
  });

  it('四个字段互相独立', () => {
    const f = createObjectiveFusion();
    let out = f.observe([]);
    for (let i = 0; i < 3; i++) {
      out = f.observe([
        {
          redBase: hp(5000, 0.4),
          redOutpost: null,
          blueBase: hp(4800, 0.4),
          blueOutpost: hp(1500, 0.4),
        },
      ]);
    }
    expect(out.redBase).toBe(5000);
    expect(out.redOutpost).toBeNull(); // 一个读不到不拖垮其余三个
    expect(out.blueBase).toBe(4800);
    expect(out.blueOutpost).toBe(1500);
  });
});
