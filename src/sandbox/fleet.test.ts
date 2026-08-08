import { describe, it, expect } from 'vitest';
import { createFleet, rosterKey, type FleetMember } from './fleet';
import { fixture } from './__fixtures__/load';
import { readObjectives } from './objectives';
import type { Frame } from '../vision/frame';

const alive = () => fixture('B1Hero', 1400).frame; // 198/200，有标记
const dead = () => fixture('B1Hero', 690).frame; // 阵亡，全 UI 灰化
const card = () => fixture('B1Hero', 300).frame; // 等待卡：没有 HUD
const blank = (): Frame => ({
  data: new Uint8ClampedArray(852 * 480 * 4),
  width: 852,
  height: 480,
});

/** 模拟官方阵亡效果：保留亮度与字形，只把整帧抽成灰度。 */
const greyed = (frame: Frame): Frame => {
  const data = new Uint8ClampedArray(frame.data);
  for (let i = 0; i < data.length; i += 4) {
    const y = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    data[i] = y;
    data[i + 1] = y;
    data[i + 2] = y;
  }
  return { data, width: frame.width, height: frame.height };
};

const B1: FleetMember = { id: 'b1', team: 'blue', num: 1, kind: 'ground' };
const B6: FleetMember = { id: 'b6', team: 'blue', num: 6, kind: 'drone' };

describe('rosterKey', () => {
  it('内容相同则指纹相同 —— 签名过期换来的新 catalog 不该重建采样链', () => {
    // 这是一个真实缺陷的回归测试：HLS 签名过期时 useCatalog 会重取，
    // 拿回内容完全相同但对象身份全新的一份 catalog。按对象身份重建的话，
    // 十路的最后位置与目标血量的累积证据会全部清零，而这在一场比赛里会反复发生。
    const a: FleetMember[] = [{ ...B1 }, { ...B6 }];
    const b: FleetMember[] = [{ ...B1 }, { ...B6 }]; // 全新对象，内容一致
    expect(a[0]).not.toBe(b[0]);
    expect(rosterKey(a)).toBe(rosterKey(b));
  });

  it('身份或机型变了就必须换指纹', () => {
    expect(rosterKey([B1])).not.toBe(rosterKey([{ ...B1, num: 3 }]));
    expect(rosterKey([B1])).not.toBe(rosterKey([{ ...B1, kind: 'drone' }]));
    expect(rosterKey([B1])).not.toBe(rosterKey([{ ...B1, id: 'other' }]));
    expect(rosterKey([B1])).not.toBe(rosterKey([B1, B6]));
  });
});

describe('createFleet', () => {
  it('把位姿搬到场地系，并数出有几个目标可画', () => {
    const fleet = createFleet([B1]);
    const snap = fleet.observe(0, [{ id: 'b1', frame: alive() }]);
    expect(snap.located).toBe(1);
    expect(snap.live).toBe(1);
    expect(snap.withHud).toBe(1);
    const b1 = snap.robots[0];
    expect(b1.pose).not.toBeNull();
    // 小地图归一化坐标已经换成米制 —— 渲染层拿到的必须是场地坐标
    expect(Math.abs(b1.pose!.x)).toBeLessThan(14.5);
    expect(b1.hp).toBe(198);
  });

  it('认不出身份的机位直接丢掉，不进沙盘', () => {
    // 主视角、多宫格合集都会走到这里。猜一个身份给它，等于把画面画到别人头上
    const fleet = createFleet([B1]);
    const snap = fleet.observe(0, [
      { id: 'b1', frame: alive() },
      { id: '不认识的机位', frame: alive() },
    ]);
    expect(snap.robots).toHaveLength(1);
  });

  it('这一路被切走时保留最后位置，只让它变陈旧', () => {
    // 赛中某台机器人缺席，导播把那一路切成过渡画面。既不是阵亡也不是没开赛。
    const fleet = createFleet([B1]);
    fleet.observe(0, [{ id: 'b1', frame: alive() }]);
    const gone = fleet.observe(5_000, [{ id: 'b1', frame: card() }]);
    expect(gone.robots[0].phase).toBe('off');
    expect(gone.robots[0].status).toBe('unknown');
    expect(gone.robots[0].pose).not.toBeNull(); // 位置留着
    expect(gone.robots[0].poseAgeMs).toBe(5_000); // 但已陈旧，渲染层据此褪色
    expect(gone.located).toBe(1);
    expect(gone.live).toBe(0);
  });

  it('阵亡算 withHud 不算 live —— HUD 还在，只是这台死了', () => {
    const fleet = createFleet([B1]);
    fleet.observe(0, [{ id: 'b1', frame: alive() }]);
    const snap = fleet.observe(1_000, [{ id: 'b1', frame: dead() }]);
    expect(snap.withHud).toBe(1);
    expect(snap.live).toBe(0);
    expect(snap.robots[0].hp).toBe(0);
    expect(snap.robots[0].pose).not.toBeNull();
  });

  it('阵亡灰化帧不应污染战略目标血量', () => {
    const liveFrame = alive();
    const greyFrame = greyed(liveFrame);

    // 同一时刻、同一块 5000 记分板只做灰度化，OCR 就把蓝方基地截成了 5。
    // blueOutpost=5 的置信度还高于融合门槛，若进入 fusion 会立刻污染空状态。
    expect(readObjectives(liveFrame).blueBase).toMatchObject({ value: 5000, raw: '5000' });
    expect(readObjectives(greyFrame).blueBase).toMatchObject({ value: 5, raw: '5' });
    expect(readObjectives(greyFrame).blueOutpost).toMatchObject({ value: 5, raw: '5' });

    const fleet = createFleet([B1]);
    const before = fleet.observe(0, [{ id: 'b1', frame: liveFrame }]).objectives;
    expect(before.blueBase).toBe(5000);
    expect(before.blueOutpost).toBeNull();

    const after = fleet.observe(1_000, [{ id: 'b1', frame: greyFrame }]).objectives;
    expect(after).toEqual(before);
  });

  it('空中路不读血量、也不判阵亡', () => {
    const fleet = createFleet([B6]);
    const snap = fleet.observe(0, [{ id: 'b6', frame: dead() }]);
    expect(snap.robots[0].hp).toBeNull();
    expect(snap.robots[0].status).not.toBe('dead');
  });

  it('十路全部 off 时目标血量立即重置为初态', () => {
    const members: FleetMember[] = Array.from({ length: 10 }, (_, i) => ({
      id: `ground-${i}`,
      team: i < 5 ? 'red' : 'blue',
      num: (i % 5) + 1,
      kind: 'ground',
    }));
    const fleet = createFleet(members);
    const liveSamples = members.map(({ id }) => ({ id, frame: alive() }));
    const endedSamples = members.map(({ id }) => ({ id, frame: blank() }));

    const during = fleet.observe(0, liveSamples);
    expect(Object.values(during.objectives).some((hp) => hp !== null)).toBe(true);

    const ended = fleet.observe(1_000, endedSamples);
    expect(ended.withHud).toBe(0);
    expect(ended.objectives).toEqual({
      redBase: null,
      redOutpost: null,
      blueBase: null,
      blueOutpost: null,
    });
  });

  it('没被采到的路保持原状，不清空', () => {
    // 流断了、标签页刚切回来：这一路本轮没有样本，不该被当成「消失了」
    const fleet = createFleet([B1, B6]);
    fleet.observe(0, [{ id: 'b1', frame: alive() }]);
    const snap = fleet.observe(1_000, []); // 一路都没采到
    expect(snap.robots.find((r) => r.id === 'b1')!.pose).not.toBeNull();
  });
});
