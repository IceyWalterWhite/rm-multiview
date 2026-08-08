import { describe, it, expect } from 'vitest';
import { createRobotTracker } from './tracker';
import { isHudGreyedOut, scoreboardLit, scoreboardSaturation } from './alive';
import { groundObjectivesReadable, groundPhase, observePhase } from './streamPhase';
import { fixture } from './__fixtures__/load';

const alive = () => fixture('B1Hero', 1400).frame; // 198/200，有标记
const lowHp = () => fixture('B1Hero', 2200).frame; // 20/200，濒死但活着
const dead = () => fixture('B1Hero', 690).frame; // 阵亡，全 UI 灰化
const waiting = () => fixture('B1Hero', 300).frame; // 等待卡
const blank = () => ({ data: new Uint8ClampedArray(852 * 480 * 4), width: 852, height: 480 });

describe('isHudGreyedOut', () => {
  it('separates a dead robot from one that is merely nearly dead', () => {
    // 这是整个阵亡判据的命门：濒死时血条同样近乎空，只有记分板能把两者分开
    // 实测存活 0.347~0.749、阵亡 0.000，中间没有过渡带
    expect(scoreboardSaturation(dead())).toBeLessThan(0.05);
    expect(scoreboardSaturation(lowHp())).toBeGreaterThan(0.3);
    expect(isHudGreyedOut(dead())).toBe(true);
    expect(isHudGreyedOut(lowHp())).toBe(false);
  });

  it('does not mistake a black frame for a greyed-out HUD', () => {
    // 黑屏/丢帧/断流的饱和度同样是 0；阵亡的特征是 UI 仍在渲染、只是去了色
    expect(scoreboardSaturation(blank())).toBe(0);
    expect(scoreboardLit(blank())).toBe(0);
    expect(scoreboardLit(dead())).toBeGreaterThan(0.5);
    expect(isHudGreyedOut(blank())).toBe(false);
  });
});

describe('逐路自判', () => {
  /**
   * 这一组是「取消全局开赛检测」的正当性证明。
   *
   * 早先 isHudGreyedOut 单独不足以判阵亡 —— 等待卡上记分板同样掉色，
   * 所以必须再要一个来自 matchstate 的全局 roundLive 才敢解读。
   * 现在改用「HUD 在不在」这条逐路判据，等待卡自己就被识别成 off，
   * 全局标志不再需要：它要防的那个场景，判据本身已经覆盖了。
   */
  it('等待卡自己就是 off，不需要外部告诉它没开赛', () => {
    expect(scoreboardLit(waiting())).toBeGreaterThan(0.97); // 整片过亮 = 没有 HUD
    expect(observePhase(waiting(), 'ground').phase).toBe('off');
  });

  it('灰化的 HUD 是 dead，全黑帧是 off —— 两者饱和度同样是 0', () => {
    expect(observePhase(dead(), 'ground').phase).toBe('dead');
    expect(observePhase(blank(), 'ground').phase).toBe('off');
  });

  it('濒死仍然是 live —— HUD 还在、还有阵营色', () => {
    expect(observePhase(lowHp(), 'ground').phase).toBe('live');
  });

  it('彩色的 0 血阵亡仍可读取共享记分板，灰化阵亡不可读', () => {
    const coloredDead = {
      lit: 0.8,
      sat: 0.5,
      hp: { current: 0, max: 200, confidence: 1, raw: '0/200' },
    };
    expect(groundPhase(coloredDead)).toBe('dead');
    expect(groundObjectivesReadable(coloredDead)).toBe(true);

    const greyedDead = { lit: 0.8, sat: 0, hp: null };
    expect(groundPhase(greyedDead)).toBe('dead');
    expect(groundObjectivesReadable(greyedDead)).toBe(false);

    const noHud = { lit: 1, sat: 0.5, hp: coloredDead.hp };
    expect(groundPhase(noHud)).toBe('off');
    expect(groundObjectivesReadable(noHud)).toBe(false);
  });

  it('空中路永远判不出 dead —— 它没有血量', () => {
    // 刻意喂地面路的阵亡帧：交给 ground 判是 dead（见上），交给 drone 必须不是
    expect(observePhase(dead(), 'drone').phase).not.toBe('dead');
    expect(observePhase(dead(), 'drone').hp).toBeNull();
  });
});

describe('createRobotTracker', () => {
  it('reports pose and health while the robot is alive', () => {
    const t = createRobotTracker('b1', 'blue');
    const s = t.observe(0, alive());
    expect(s.status).toBe('alive');
    expect(s.hp).toEqual({ current: 198, max: 200 });
    expect(s.pose).not.toBeNull();
    expect(s.poseAgeMs).toBe(0);
    expect(s.objectivesReadable).toBe(true);
  });

  it('never reports health or death for a drone — it has neither', () => {
    // 空中机器人没有血量，也就不存在阵亡。这里刻意喂地面路的帧：
    // 同样这几帧交给 ground 跟踪器会读出 198/200 并在 dead() 上判阵亡（见上下两条），
    // 交给 drone 跟踪器则必须两样都不给 —— 证明拦截发生在「问不问」这一层，
    // 而不是碰巧读不出来。
    const t = createRobotTracker('b6', 'blue', 'drone');
    expect(t.observe(0, alive()).hp).toBeNull();
    const s = t.observe(1_000, dead());
    expect(s.status).not.toBe('dead');
    expect(s.hp).toBeNull();
  });

  it('keeps the last known position and zeroes health on death', () => {
    const t = createRobotTracker('b1', 'blue');
    t.observe(0, alive());
    const s = t.observe(1_000, dead());
    expect(s.status).toBe('dead');
    expect(s.hp).toEqual({ current: 0, max: 200 }); // 上限沿用，当前记 0
    expect(s.pose).not.toBeNull(); // 坐标保留
    expect(s.poseAgeMs).toBe(1_000); // 但已经陈旧，UI 该褪色
    expect(s.objectivesReadable).toBe(false); // 这份阵亡夹具是整体灰化 HUD
  });

  it('calls a blank frame unknown rather than dead', () => {
    // 漏检率有 2~7%，把「没看见」当「死了」会疯狂误报
    const t = createRobotTracker('b1', 'blue');
    t.observe(0, alive());
    const s = t.observe(500, blank());
    expect(s.status).toBe('unknown');
    expect(s.hp).toEqual({ current: 198, max: 200 }); // 保留最后已知值，不清空
  });

  it('过渡画面是 unknown 而不是 dead —— 这一路只是被切走了', () => {
    // 赛中某台机器人缺席时导播会切走那一路。它既不是阵亡也不是没开赛，
    // 沿用最后坐标 + poseAgeMs 走高，由 UI 褪色。
    const t = createRobotTracker('b1', 'blue');
    t.observe(0, alive());
    const s = t.observe(2_000, waiting());
    expect(s.status).toBe('unknown');
    expect(s.pose).not.toBeNull();
    expect(s.poseAgeMs).toBe(2_000);
  });

  it('needs the new max to repeat before accepting an upgrade', () => {
    // 上限只在吃增益时跳变；单帧误识不该翻动它
    const t = createRobotTracker('b3', 'blue');
    t.observe(0, fixture('B3Infantry', 1400).frame); // 275/275
    expect(t.state.hp).toEqual({ current: 275, max: 275 });

    const upgraded = fixture('B3Infantry', 1660).frame; // 40/400
    const first = t.observe(1_000, upgraded);
    expect(first.hp).toEqual({ current: 40, max: 275 }); // 掉血立刻生效，上限先按兵不动
    const second = t.observe(2_000, upgraded);
    expect(second.hp).toEqual({ current: 40, max: 400 }); // 连续两帧一致，采纳新上限
  });

  it('reports health for the stream that never shows a minimap', () => {
    const t = createRobotTracker('b2', 'blue');
    const s = t.observe(0, fixture('B2SuqqreProject', 1400).frame);
    expect(s.status).toBe('alive');
    expect(s.hp).toEqual({ current: 250, max: 250 });
    expect(s.pose).toBeNull(); // 有血量没位置，两者必须能各自缺席
  });
});
