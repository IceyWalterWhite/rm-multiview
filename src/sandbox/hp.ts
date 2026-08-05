import { HP_TEXT } from '../rmui/layout';
import type { Frame } from '../vision/frame';
import { readField, type GlyphCountRange } from './digits';

export interface HpReading {
  current: number;
  max: number;
  /** 0..1。取所有字形里最不确定的那个 —— 一位读错整个数就废了，木桶效应。 */
  confidence: number;
  /** 识别出的原始字符串，排障时比数字有用。 */
  raw: string;
}

/** 「x / y」最少 4 个字形（如 "0/40"），最多 9 个（如 "1000/1000"）。 */
const HP_GLYPHS: GlyphCountRange = { min: 4, max: 9 };

/**
 * 读出「当前血量 / 血量上限」。
 *
 * 上限必须一起读：比赛中吃增益会升级，同一机器人的上限在一场里会变（实测 200→250→300→400），
 * 按角色写死一定错。
 *
 * 格式校验（一个斜杠 + 两边都是数字 + 当前值不超上限）同时充当候选的否决条件，
 * 这是整条管线里最便宜也最有效的一道防线。
 *
 * 返回 null = 这一帧读不出来：阵亡（血条被模块状态面板整个替换）、未开赛、
 * 或没有任何切分候选能通过校验。
 */
export function readHp(frame: Frame): HpReading | null {
  const hit = readField(frame, HP_TEXT, HP_GLYPHS, ({ raw }) => {
    const parts = raw.split('/');
    if (parts.length !== 2) return null;
    if (!/^\d{1,4}$/.test(parts[0]) || !/^\d{1,4}$/.test(parts[1])) return null;
    const current = Number(parts[0]);
    const max = Number(parts[1]);
    // 当前血量不可能超过上限；超了说明至少读错一位，宁可不报
    if (max === 0 || current > max) return null;
    return { current, max };
  });
  if (!hit) return null;
  return { ...hit.value, confidence: hit.read.confidence, raw: hit.read.raw };
}
