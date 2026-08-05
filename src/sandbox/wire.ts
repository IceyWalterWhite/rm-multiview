import type { Side } from '../types';
import type { RobotState } from './types';

/**
 * 位置未知时的哨兵值。
 * 沙盘约定用 (-1,-1) 表示「这一帧没识别到」，渲染层据此不画该机器人 ——
 * 比传 null 省一次判空，也让服务端/浏览器两种部署形态共用同一份线格式。
 */
export const UNKNOWN_X = -1;
export const UNKNOWN_Y = -1;

export interface WireRobot {
  id: string;
  side: Side;
  /** 小地图归一化坐标；(-1,-1) = 本帧未识别到，不要显示 */
  x: number;
  y: number;
  /** 弧度；null = 位置有效但朝向没读到 */
  heading: number | null;
  /** 当前血量；null = 从未读到过 */
  hp: number | null;
  maxHp: number | null;
  status: RobotState['status'];
  /** 位置的陈旧程度（ms），渲染层据此褪色 */
  poseAgeMs: number;
}

/**
 * 把跟踪器状态转成沙盘的线格式。
 *
 * 阵亡时仍然发最后一次识别到的坐标（血量为 0）—— 灰化的小地图读不出新位置，
 * 但观众需要知道它倒在哪里。位置从未识别到过（比如那位全场关掉小地图的操作手）
 * 才发 (-1,-1)。
 */
export function toWire(state: RobotState): WireRobot {
  const known = state.pose !== null;
  return {
    id: state.streamId,
    side: state.side,
    x: known ? state.pose!.x : UNKNOWN_X,
    y: known ? state.pose!.y : UNKNOWN_Y,
    heading: known ? state.pose!.heading : null,
    hp: state.hp ? state.hp.current : null,
    maxHp: state.hp ? state.hp.max : null,
    status: state.status,
    poseAgeMs: state.poseAgeMs,
  };
}
