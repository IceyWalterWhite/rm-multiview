import { FIELD_X, FIELD_Y, OBJECTIVE_MAX_HP } from '../sandbox/fieldMap';
import type { SandboxRobot, SandboxSnapshot } from '../sandbox/fleet';

/**
 * 演示用的假车队。**只给 `?stagedemo` 用**，随 StageDemo 一起被 DCE，不进生产包。
 *
 * 存在的理由：没有直播时十路全是占位色块，识别侧一个位置都产不出，于是沙盘上的
 * 一切 —— 机器人标记、点击拾取、面板跟随、四条战略目标血条 —— 全都没东西可看，
 * 想验收只能去 console 里手动灌一份快照。那不叫可验收。
 *
 * 这里的数字全是编的，但**形状是真的**：位姿按 3 Hz 更新、血量会掉、有一路
 * 阵亡、有一路始终定位不到（沙盘该显示 9/10 而不是假装十路都好），
 * 战略目标血量各自按不同速度往下走。手感与真实赛况的差别只在数据来源。
 */

interface Slot {
  id: string;
  team: 'red' | 'blue';
  num: number;
  kind: 'ground' | 'drone';
  /** 巡逻中心（场地米制） */
  hx: number;
  hy: number;
  /** 巡逻半径 */
  rx: number;
  ry: number;
  /** 相位错开，免得十台车像编队一样同步摆动 */
  phase: number;
  maxHp: number;
}

const ROSTER: Slot[] = [
  { id: 'demo-r1', team: 'red', num: 1, kind: 'ground', hx: 8.6, hy: 2.2, rx: 3.0, ry: 2.4, phase: 0.0, maxHp: 400 },
  { id: 'demo-r2', team: 'red', num: 2, kind: 'ground', hx: 11.0, hy: -2.6, rx: 2.0, ry: 1.6, phase: 1.1, maxHp: 250 },
  { id: 'demo-r3', team: 'red', num: 3, kind: 'ground', hx: 3.6, hy: 4.4, rx: 3.4, ry: 2.2, phase: 2.3, maxHp: 200 },
  { id: 'demo-r4', team: 'red', num: 4, kind: 'ground', hx: 2.0, hy: -3.4, rx: 3.2, ry: 2.0, phase: 3.5, maxHp: 200 },
  { id: 'demo-r5', team: 'red', num: 6, kind: 'drone', hx: 6.0, hy: 0.8, rx: 4.5, ry: 3.0, phase: 4.7, maxHp: 300 },
  { id: 'demo-b1', team: 'blue', num: 1, kind: 'ground', hx: -8.6, hy: 1.0, rx: 3.0, ry: 2.4, phase: 0.6, maxHp: 400 },
  { id: 'demo-b2', team: 'blue', num: 2, kind: 'ground', hx: -11.0, hy: 5.8, rx: 2.0, ry: 1.6, phase: 1.8, maxHp: 250 },
  { id: 'demo-b3', team: 'blue', num: 3, kind: 'ground', hx: -3.6, hy: -1.2, rx: 3.4, ry: 2.2, phase: 2.9, maxHp: 200 },
  { id: 'demo-b4', team: 'blue', num: 4, kind: 'ground', hx: -2.0, hy: 6.4, rx: 3.2, ry: 2.0, phase: 4.1, maxHp: 200 },
  { id: 'demo-b5', team: 'blue', num: 6, kind: 'drone', hx: -6.0, hy: 2.4, rx: 4.5, ry: 3.0, phase: 5.3, maxHp: 300 },
];

/** 这一路演示「始终定位不到」：沙盘该显示 9/10，而不是假装十路都好 */
const NEVER_LOCATED = 'demo-b4';
/** 这一路演示阵亡：标记该褪到半透明 */
const DEAD = 'demo-r4';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 用两个不同频率的正弦画李萨如轨迹：不会走直线，也不会绕出场地 */
function poseAt(s: Slot, t: number) {
  const a = t * 0.22 + s.phase;
  const b = t * 0.17 + s.phase * 1.7;
  const x = clamp(s.hx + s.rx * Math.sin(a), FIELD_X[0] + 0.6, FIELD_X[1] - 0.6);
  const y = clamp(s.hy + s.ry * Math.cos(b), FIELD_Y[0] + 0.6, FIELD_Y[1] - 0.6);
  // 朝向取速度方向：车头永远指着它正在去的地方
  const dx = s.rx * 0.22 * Math.cos(a);
  const dy = -s.ry * 0.17 * Math.sin(b);
  return { x, y, yaw: Math.atan2(dy, dx) };
}

/** 慢速锯齿：从满血一路掉到 lowFrac，再跳回满血（模拟回合重置） */
function sawtooth(t: number, periodSec: number, lowFrac: number): number {
  const p = (t % periodSec) / periodSec;
  return 1 - p * (1 - lowFrac);
}

/**
 * @param t 从演示开始经过的秒数
 */
export function demoFleet(t: number): SandboxSnapshot {
  const robots: SandboxRobot[] = ROSTER.map((s) => {
    const dead = s.id === DEAD;
    const blind = s.id === NEVER_LOCATED;
    const hp = dead ? 0 : Math.round(s.maxHp * sawtooth(t + s.phase * 7, 95, 0.15));
    return {
      id: s.id,
      team: s.team,
      num: s.num,
      kind: s.kind,
      pose: blind ? null : poseAt(s, t),
      poseAgeMs: blind ? Infinity : 120,
      hp,
      maxHp: s.maxHp,
      status: dead ? 'dead' : 'alive',
      phase: 'live',
    };
  });

  return {
    robots,
    objectives: {
      redBase: Math.round(OBJECTIVE_MAX_HP.base * sawtooth(t, 220, 0.25)),
      blueBase: Math.round(OBJECTIVE_MAX_HP.base * sawtooth(t + 40, 260, 0.4)),
      redOutpost: Math.round(OBJECTIVE_MAX_HP.outpost * sawtooth(t + 15, 130, 0)),
      blueOutpost: Math.round(OBJECTIVE_MAX_HP.outpost * sawtooth(t, 170, 0.2)),
    },
    withHud: robots.length,
    live: robots.filter((r) => r.status === 'alive').length,
    located: robots.filter((r) => r.pose !== null).length,
  };
}
