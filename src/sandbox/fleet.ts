import { markerToField, type FieldPose } from './fieldMap';
import { createObjectiveFusion, type FusedObjectives, type ObjectiveFusion } from './objectiveFusion';
import { readObjectives, type Objectives } from './objectives';
import type { SampleResult } from './sampler';
import type { StreamPhase } from './streamPhase';
import { createRobotTracker, type RobotTracker } from './tracker';
import type { RobotStatus, StreamKind } from './types';

/**
 * 多路汇聚：十路各自的跟踪器 → 一份全场状态。
 *
 * 每台机器人只由它自己那一路负责，天生没有多目标跟踪里最难的数据关联问题 ——
 * 汇聚在这里几乎是平凡的。真正需要跨路合并的只有**战略目标血量**：
 * 那四个数字长在十路共享的同一条记分板上，十份读数投票选一份
 * （见 {@link createObjectiveFusion}）。
 *
 * 本层也不做全局开赛检测。回合边界是从**逐路相位**推出来的：
 * 一路 live 都没有 = 这个回合结束了。这不是另立一个判据，只是把已有的十份自判读了一遍。
 */

/** 一路的身份。由 catalog 的 role 经 {@link identifyRole} 解析而来。 */
export interface FleetMember {
  /** 流名，如 fight2026001。也是 DOM 里 data-view-id 的值 */
  id: string;
  team: 'red' | 'blue';
  /** 官方编号：1 英雄 / 2 工程 / 3·4 步兵 / 6 空中 */
  num: number;
  kind: StreamKind;
}

export interface SandboxRobot extends FleetMember {
  /** 场地米制位姿。null = 这一路从未识别到过位置（比如全场关掉小地图的操作手） */
  pose: FieldPose | null;
  /** 位置的陈旧程度（ms）。渲染层据此褪色 */
  poseAgeMs: number;
  hp: number | null;
  maxHp: number | null;
  status: RobotStatus;
  /** 这一路本帧的自判相位 */
  phase: StreamPhase;
}

export interface SandboxSnapshot {
  robots: SandboxRobot[];
  objectives: FusedObjectives;
  /**
   * 自判「画面上有赛事 HUD」的路数（live + dead）。
   *
   * 回合间歇时十路会**同时**切成宣传卡，这个数整体掉到 0 —— 那是判据在正常工作，
   * 不是故障。2026-08-05 现网实测：Round 2/3「准备中」期间十路全部 off，
   * 沙盘拒绝从宣传卡上读出任何东西。
   */
  withHud: number;
  /** 其中自判为「正在放比赛且这台还活着」的路数 */
  live: number;
  /** 有位置可画的路数 —— 沙盘上能显示几个目标，看的是这个 */
  located: number;
}

export interface Fleet {
  observe(nowMs: number, samples: readonly SampleResult[]): SandboxSnapshot;
  readonly snapshot: SandboxSnapshot;
}

/**
 * 名单指纹：**只有它变了才该重建整条采样链。**
 *
 * 存在的理由是一个真实缺陷：HLS 签名过期时 useCatalog 会重取，拿回一份内容完全相同、
 * 但对象身份是新的 catalog。若按对象身份重建，十路的最后位置与目标血量的累积证据
 * 会全部清零 —— 观众看到整场标记凭空消失再慢慢长回来，而签名过期在一场比赛里
 * 会反复发生。抽成纯函数是为了让这条不变量能被测到（见 fleet.test.ts）。
 */
export function rosterKey(members: readonly FleetMember[]): string {
  return members.map((m) => `${m.id}/${m.team}${m.num}/${m.kind}`).join(',');
}

interface Slot {
  member: FleetMember;
  tracker: RobotTracker;
  pose: FieldPose | null;
  poseAgeMs: number;
  hp: number | null;
  maxHp: number | null;
  status: RobotStatus;
  phase: StreamPhase;
}

export function createFleet(members: readonly FleetMember[]): Fleet {
  const slots = new Map<string, Slot>();
  for (const m of members) {
    slots.set(m.id, {
      member: m,
      tracker: createRobotTracker(m.id, m.team, m.kind),
      pose: null,
      poseAgeMs: Infinity,
      hp: null,
      maxHp: null,
      status: 'unknown',
      phase: 'off',
    });
  }

  const fusion: ObjectiveFusion = createObjectiveFusion();

  function snapshot(): SandboxSnapshot {
    const robots = [...slots.values()].map((s) => ({
      ...s.member,
      pose: s.pose,
      poseAgeMs: s.poseAgeMs,
      hp: s.hp,
      maxHp: s.maxHp,
      status: s.status,
      phase: s.phase,
    }));
    return {
      robots,
      objectives: fusion.state,
      withHud: robots.filter((r) => r.phase !== 'off').length,
      live: robots.filter((r) => r.phase === 'live').length,
      located: robots.filter((r) => r.pose !== null).length,
    };
  }

  return {
    observe(nowMs, samples) {
      const objectiveReadings: Objectives[] = [];
      // 本轮没被采到的路（流断了、标签页刚切回来）保持上一轮状态，不动它。
      const seen = new Set<string>();

      for (const s of samples) {
        const slot = slots.get(s.id);
        if (!slot) continue; // 认不出身份的机位（合集、主视角）不进沙盘
        seen.add(s.id);

        const state = slot.tracker.observe(nowMs, s.frame);
        slot.phase = state.phase;
        slot.status = state.status;
        slot.hp = state.hp ? state.hp.current : null;
        slot.maxHp = state.hp ? state.hp.max : null;
        slot.poseAgeMs = state.poseAgeMs;
        // 位置一旦识别到就留着 —— 阵亡、被切走、漏检都不清空，交给 poseAgeMs 褪色
        if (state.pose) slot.pose = markerToField(state.pose, slot.member.kind);

        // 战略目标只在共享记分板仍可信的地面路上读。这个信号不能拿 phase 代替：
        // 彩色 HUD 的 0 血阵亡是 dead，但顶部数字仍正常；整体灰化的 dead 才会把
        // 5000 误切成 5 等短数字。空中路没有这块记分板，恒为不可读。
        if (slot.member.kind === 'ground' && state.objectivesReadable) {
          objectiveReadings.push(readObjectives(s.frame));
        }
      }

      for (const [id, slot] of slots) {
        if (!seen.has(id)) slot.poseAgeMs = slot.pose ? slot.poseAgeMs : Infinity;
      }

      const allOff = [...slots.values()].every((s) => s.phase === 'off');
      // 十路全部 off = HUD 已从所有机位消失，回合结束。此时立刻清空目标血量，
      // 让血条回到未知初态；不能等下一回合出现 live，否则赛间会一直挂着旧值。
      // 也不能用「没有 live」代替：全员阵亡时各路是 dead，HUD 与最终血量仍可信。
      if (allOff) fusion.reset();

      if (objectiveReadings.length > 0) fusion.observe(objectiveReadings);

      return snapshot();
    },
    get snapshot() {
      return snapshot();
    },
  };
}
