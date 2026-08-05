import {
  DEAD_SCOREBOARD_MIN_LIT,
  DEAD_SCOREBOARD_SAT,
  TEAM_BLUE,
  TEAM_RED,
  TOP_SCOREBOARD,
} from '../rmui/layout';
import { resolveRect, type Frame } from '../vision/frame';
import { fractionInRange } from '../vision/mask';
import { rgbToHsv } from '../vision/hsv';

/**
 * 顶部记分板上还剩多少阵营色。
 *
 * 机器人阵亡时整个赛事 UI 灰度化，这个值精确塌到 0.000；存活时是 0.35~0.75，
 * 连血量只剩 20/200 的濒死状态都还有 0.39。中间是空的，没有过渡带。
 *
 * 关键：这**不是**「HUD 是否存在」的判据 —— 等待卡时它有 0.547。
 * 只有在「回合进行中」（见 matchstate）成立之后，低饱和才能解读为阵亡。
 */
export function scoreboardSaturation(frame: Frame): number {
  const rect = resolveRect(TOP_SCOREBOARD, frame.width, frame.height);
  return fractionInRange(frame, rect, TEAM_RED) + fractionInRange(frame, rect, TEAM_BLUE);
}

/** 记分板区域里够亮的像素占比 —— 用来区分「画着但灰了」和「压根没画」。 */
export function scoreboardLit(frame: Frame): number {
  const rect = resolveRect(TOP_SCOREBOARD, frame.width, frame.height);
  if (rect.w === 0 || rect.h === 0) return 0;
  let lit = 0;
  for (let y = 0; y < rect.h; y++) {
    let src = ((rect.y + y) * frame.width + rect.x) * 4;
    for (let x = 0; x < rect.w; x++, src += 4) {
      if (rgbToHsv(frame.data[src], frame.data[src + 1], frame.data[src + 2]).v > 60) lit++;
    }
  }
  return lit / (rect.w * rect.h);
}

/**
 * 赛事 UI 是否已整体灰化。
 *
 * 两个条件缺一不可：**画了东西**且**没有阵营色**。
 * 只看饱和度的话，黑屏、丢帧、流中断全都会被误判成阵亡 —— 它们的饱和度同样是 0。
 * 阵亡的特征是 UI 仍在渲染、只是被抽掉了颜色（实测亮像素占 0.770）。
 *
 * 回合进行中时，灰化 = 该机器人阵亡；此时沙盘沿用它最后一次识别到的坐标、血量记 0 ——
 * 灰掉的小地图和被模块面板顶掉的血条都读不出新值。
 */
export function isHudGreyedOut(frame: Frame): boolean {
  return scoreboardLit(frame) >= DEAD_SCOREBOARD_MIN_LIT && scoreboardSaturation(frame) < DEAD_SCOREBOARD_SAT;
}
