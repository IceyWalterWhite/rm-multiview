import type { Side } from '../types';
import {
  DRONE_MARKER_MIN_AREA_RATIO,
  DRONE_MINIMAP,
  MINIMAP,
  SELF_MARKER_MIN_AREA_RATIO,
} from '../rmui/layout';
import type { Frame, NormRect } from '../vision/frame';
import type { HpReading } from './hp';
import { detectSelfMarkerResilient } from './marker';
import { observePhase } from './streamPhase';
import type { Hp, Pose, RobotState, StreamKind } from './types';

export interface TrackerOptions {
  /**
   * 在没有历史可比对时，接受一个血量读数所需的最低置信度。
   * 留出集上唯一一次读错（146→145）置信度是 0.01，而正确读数里最低的是 0.13 ——
   * 但 25 帧的样本量太小，不足以据此定一个精确的门槛，所以这里取一个宽松值，
   * 真正的把关交给下面的时序一致性。
   */
  minConfidence: number;
  /**
   * 血量上限改变需要连续几帧读到同一个新值才采纳。
   * 上限只在吃增益时跳变，平时是常数；要求连续两帧一致，单帧误识就翻不动它。
   */
  maxChangeAgreement: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  minConfidence: 0.02,
  maxChangeAgreement: 2,
};

const MINIMAP_OF: Record<StreamKind, NormRect> = { ground: MINIMAP, drone: DRONE_MINIMAP };

/**
 * 自机标记的最小面积门限，两种机型分开给。
 * 空中那套图标小得多，且红方还被阵营底色压得只剩箭头是绿的 ——
 * 沿用地面的比例会把红方无人机整个滤掉（实测检出 1.2%）。见 layout.ts 的扫描表。
 */
const MIN_AREA_RATIO_OF: Record<StreamKind, number> = {
  ground: SELF_MARKER_MIN_AREA_RATIO,
  drone: DRONE_MARKER_MIN_AREA_RATIO,
};

export interface RobotTracker {
  /**
   * 喂一帧。**不需要任何全局「开赛」标志** —— 这一路自己看得出来。
   *
   * 早先这里收一个来自 matchstate 的 roundLive，那是错的：赛中某台机器人缺席时
   * 导播会把那一路切成过渡画面，其余九路照常比赛。全局标志对被切走的那一路是错的，
   * 会让我们把一张转播照片当成有效 HUD 去读。自判见 {@link observePhase}。
   */
  observe(nowMs: number, frame: Frame): RobotState;
  readonly state: RobotState;
}

export function createRobotTracker(
  streamId: string,
  side: Side,
  kind: StreamKind = 'ground',
  opts: TrackerOptions = DEFAULT_TRACKER_OPTIONS,
): RobotTracker {
  const minimap = MINIMAP_OF[kind];
  const minAreaRatio = MIN_AREA_RATIO_OF[kind];
  let pose: Pose | null = null;
  let poseAt = 0;
  let hp: Hp | null = null;
  let hpAt = 0;
  let status: RobotState['status'] = 'unknown';
  let phase: RobotState['phase'] = 'off';
  let objectivesReadable = false;
  /** 等待确认的新上限：连续读到 maxChangeAgreement 次才生效 */
  let pendingMax: { value: number; count: number } | null = null;

  function acceptHp(reading: HpReading, nowMs: number): void {
    if (!hp && reading.confidence < opts.minConfidence) return;

    if (hp && reading.max !== hp.max) {
      // 上限跳变要么是吃了增益，要么是某一位读错了。让它连续出现几次再认。
      if (pendingMax && pendingMax.value === reading.max) pendingMax.count++;
      else pendingMax = { value: reading.max, count: 1 };
      if (pendingMax.count < opts.maxChangeAgreement) {
        // 上限先不动，但当前值只要不超旧上限仍然可用 —— 掉血是最需要实时的信息
        if (reading.current <= hp.max) {
          hp = { current: reading.current, max: hp.max };
          hpAt = nowMs;
        }
        return;
      }
    } else {
      pendingMax = null;
    }
    hp = { current: reading.current, max: reading.max };
    hpAt = nowMs;
  }

  function snapshot(nowMs: number): RobotState {
    return {
      streamId,
      side,
      status,
      phase,
      objectivesReadable,
      pose,
      poseAgeMs: pose ? nowMs - poseAt : Infinity,
      hp,
      hpAgeMs: hp ? nowMs - hpAt : Infinity,
    };
  }

  return {
    observe(nowMs, frame) {
      const observed = observePhase(frame, kind);
      const reading = observed.hp;
      phase = observed.phase;
      objectivesReadable = observed.objectivesReadable;

      if (phase === 'off') {
        // 这一路本帧没有 HUD：过渡画面、转播镜头、回合间歇、信号中断。
        // **不是阵亡**，也不该去读 —— 照片上读出来的任何东西都是噪声。
        // 沿用最后已知位置，由 poseAgeMs 带着 UI 褪色。
        status = 'unknown';
        return snapshot(nowMs);
      }

      if (phase === 'dead') {
        // 沿用最后一次识别到的坐标，血量记 0：灰掉的小地图读不出新位置，
        // 但观众需要知道它倒在哪里。
        status = 'dead';
        if (hp) {
          hp = { current: 0, max: hp.max };
          hpAt = nowMs;
        }
        return snapshot(nowMs);
      }

      const marker = detectSelfMarkerResilient(frame, minimap, minAreaRatio);

      if (!reading && !marker) {
        // HUD 在（或空中路没得判）却什么都没读到：遮挡、伤害泛光压低饱和、
        // 或那位全场关掉小地图的操作手。同样不是阵亡。
        status = 'unknown';
        return snapshot(nowMs);
      }

      status = 'alive';
      if (reading) acceptHp(reading, nowMs);
      if (marker) {
        pose = { x: marker.x, y: marker.y, heading: marker.heading };
        poseAt = nowMs;
      }
      return snapshot(nowMs);
    },
    get state() {
      return snapshot(poseAt > hpAt ? poseAt : hpAt);
    },
  };
}
