import type { StreamKind } from './types';

/**
 * 机位名 → 机器人身份。
 *
 * catalog 给的是中文机位名（`fpvData[].role`），沙盘要的是「哪一队的几号车」。
 * 现网实测的完整词表（2026-08-05 取自 live_game_info.json，全部五个赛区一致）：
 *
 *     主视角（无解说版）        ← 非 FPV，catalog 已按 DISCARD_ROLE_KEYWORDS 丢弃
 *     红方英雄第一视角           → red 1
 *     红方工程第一视角           → red 2
 *     红方3号步兵第一视角        → red 3
 *     红方4号步兵第一视角        → red 4
 *     红方空中机器人第一视角      → red 6（drone）
 *     红方无人机第一视角         → red 6（drone，东部赛区用的是这个叫法）
 *     红方机器人第一视角合集      ← 多宫格合集，catalog 已丢弃
 *     蓝方…（同上，共 5 路）
 *
 * 于是每场恰好 **10 路 FPV**，双方各 5 台。哨兵没有操作手视角，拿不到位置。
 *
 * **认不出就返回 null，绝不猜。** 猜错的代价是把 A 车的坐标画到 B 车头上 ——
 * 那比不画更糟，观众没有任何办法看出来。
 */
export interface RobotIdentity {
  team: 'red' | 'blue';
  /** 官方编号：1 英雄 / 2 工程 / 3·4·5 步兵 / 6 空中 / 7 哨兵 */
  num: number;
  kind: StreamKind;
}

/** 空中机器人的官方编号。两种叫法（空中机器人 / 无人机）现网都出现过。 */
const AERIAL_NUM = 6;

export function identifyRole(role: string): RobotIdentity | null {
  const team = role.includes('红方') ? 'red' : role.includes('蓝方') ? 'blue' : null;
  if (!team) return null;

  // 空中先判：它的名字里没有数字，而下面的步兵分支靠数字
  if (role.includes('空中') || role.includes('无人机')) {
    return { team, num: AERIAL_NUM, kind: 'drone' };
  }
  if (role.includes('英雄')) return { team, num: 1, kind: 'ground' };
  if (role.includes('工程')) return { team, num: 2, kind: 'ground' };
  if (role.includes('哨兵')) return { team, num: 7, kind: 'ground' };

  // 「3号步兵」「4号步兵」。规则允许 3~5 号，现网目前只出 3 和 4；
  // 号码从名字里取而不是按出现次序编，次序会随赛区改动而错位。
  const m = /([345])\s*号?\s*步兵/.exec(role);
  if (m) return { team, num: Number(m[1]), kind: 'ground' };

  return null;
}
