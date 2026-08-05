import {
  BLUE_BASE_HP,
  BLUE_OUTPOST_HP,
  RED_BASE_HP,
  RED_OUTPOST_HP,
} from '../rmui/layout';
import type { Frame, NormRect } from '../vision/frame';
import { readField, type GlyphCountRange } from './digits';
import { OBJECTIVE_EXEMPLARS } from './objectiveGlyphs';

export interface ObjectiveHp {
  value: number;
  confidence: number;
  raw: string;
}

export interface Objectives {
  /** null = 这一帧读不出来。绝不用 0 顶替 —— 0 是「已被击毁」这个真实状态。 */
  redBase: ObjectiveHp | null;
  redOutpost: ObjectiveHp | null;
  blueBase: ObjectiveHp | null;
  blueOutpost: ObjectiveHp | null;
}

/** 前哨站被击毁时只剩一个 "0"，所以下限必须是 1。 */
const OBJECTIVE_GLYPHS: GlyphCountRange = { min: 1, max: 4 };

/**
 * 血量上界。基地 5000、前哨站 1500，读出来比这还大一定是识别错了。
 * 留一点余量是因为规则可能微调，但数量级不会变。
 */
const MAX_BASE = 6000;
const MAX_OUTPOST = 2000;

function readOne(frame: Frame, roi: NormRect, ceiling: number): ObjectiveHp | null {
  const hit = readField(frame, roi, OBJECTIVE_GLYPHS, ({ raw }) => {
    if (!/^\d{1,4}$/.test(raw)) return null;
    const value = Number(raw);
    if (value > ceiling) return null;
    // 前导零不可能出现在这类计数上（"0500" 一定是把别的东西当成了数字）
    if (raw.length > 1 && raw[0] === '0') return null;
    return value;
  }, OBJECTIVE_EXEMPLARS);
  if (!hit) return null;
  return { value: hit.value, confidence: hit.read.confidence, raw: hit.read.raw };
}

/**
 * 读顶部记分板上的四个战略目标血量：双方基地与双方前哨站。
 *
 * 这四个数字长在**所有十路画面共享的同一条记分板**上，任意一路读出来即可，
 * 多路之间还能互相校验 —— 与机器人血量「每台只有自己那一路能看到」正好相反。
 *
 * 每个回合都会重置，所以「单调递减」的假设只在回合内成立
 * （实测蓝方前哨站 Round1 末 600、Round2 中 945）。
 *
 * 四个字段互相独立：读不到就是 null，不会因为一个失败而拖垮其余三个。
 */
export function readObjectives(frame: Frame): Objectives {
  return {
    redBase: readOne(frame, RED_BASE_HP, MAX_BASE),
    redOutpost: readOne(frame, RED_OUTPOST_HP, MAX_OUTPOST),
    blueBase: readOne(frame, BLUE_BASE_HP, MAX_BASE),
    blueOutpost: readOne(frame, BLUE_OUTPOST_HP, MAX_OUTPOST),
  };
}
