import type { Side } from '../types';
import type { StreamPhase } from './streamPhase';

/**
 * 该路是地面机器人还是空中机器人。
 * 两者的差别不止小地图位置：空中路**没有血条也没有记分板**，
 * 「开播自判」和「阵亡判定」都得走另一套（见 streamPhase.ts / tracker.ts）。
 */
export type StreamKind = 'ground' | 'drone';

export interface Pose {
  /** 小地图 ROI 内的归一化坐标（0..1，左上原点）。转场地真实坐标是渲染层的事。 */
  x: number;
  y: number;
  /** 弧度，0 = 小地图正右方，顺时针为正。null = 圆盘找到了但箭头没找到。 */
  heading: number | null;
}

export interface Hp {
  current: number;
  max: number;
}

/**
 * 机器人的三态。
 *
 * 「没看见」和「死了」必须分开 —— 这是整个模块最容易犯错的地方。
 * 单路漏检率有 2~7%（遮挡、伤害泛光压低饱和），把漏检当阵亡会疯狂误报。
 */
export type RobotStatus =
  /** HUD 亮着、记分板有色：活着。位置可能仍然缺（marker 为 null）。 */
  | 'alive'
  /** 回合进行中且赛事 UI 整体灰化：阵亡。血量记 0，坐标沿用最后一次识别到的。 */
  | 'dead'
  /** 读不到 HUD：未开赛、流断了、或这一路正在放别的东西。不是阵亡。 */
  | 'unknown';

export interface RobotState {
  streamId: string;
  side: Side;
  status: RobotStatus;
  /**
   * 这一路本帧的自判相位。由 tracker 顺带交出来，免得上层为了拿它再算一遍
   * scoreboardLit / readHp —— 那是整条链路里最贵的两步。
   */
  phase: StreamPhase;
  /** 最后一次可信位置；从未识别到则为 null。阵亡时保留不清空。 */
  pose: Pose | null;
  /** 该位置是多久之前测到的（ms）。UI 据此褪色。 */
  poseAgeMs: number;
  /**
   * 阵亡时为 {current:0, max:最后已知上限}。
   * **空中机器人恒为 null** —— 它没有血量，那一路也没有血条可读，不是「还没读到」。
   */
  hp: Hp | null;
  hpAgeMs: number;
}
