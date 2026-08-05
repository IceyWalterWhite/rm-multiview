import { DEAD_SCOREBOARD_MIN_LIT, DEAD_SCOREBOARD_SAT, HUD_ABSENT_LIT } from '../rmui/layout';
import type { Frame } from '../vision/frame';
import { scoreboardLit, scoreboardSaturation } from './alive';
import { readHp, type HpReading } from './hp';
import type { StreamKind } from './types';

/**
 * 单路的自判结果。**每一路各判各的，没有全局「开赛」标志。**
 *
 * 之所以不能用全局标志：赛中某台机器人缺席时，导播会把那一路切成过渡画面，
 * 而其余九路仍在正常比赛。全局「回合进行中」对那一路是错的 —— 它会让我们
 * 把一张转播镜头当成有效 HUD 去读，读出来的任何东西都是噪声。
 */
export type StreamPhase =
  /** HUD 在、有阵营色、血量非零：这一路正在放比赛，读出来的东西可信 */
  | 'live'
  /** HUD 在但这台机器人已阵亡：沿用最后坐标、血量记 0 */
  | 'dead'
  /** 没有 HUD：过渡画面、转播镜头、回合间歇、信号中断。这一路本帧什么都别读 */
  | 'off';

/**
 * HUD 到底在不在。
 *
 * 判据是**暗像素**而不是亮像素，这是本模块最反直觉的一条：
 * 赛事 HUD 无论是否灰化，元素之间永远留有深色底，记分板区域的亮像素占比实测
 * 落在 0.658~0.948；而导播切过去的转播镜头是一整张照片，几乎每个像素都过
 * V>60 的门槛，实测**恰好 1.000**。
 *
 * 现网 336 帧地面样本上的分离度：
 *   - 能检出自机的 112 帧：lit ∈ [0.752, 0.948]，**一帧都没到 1.000**
 *   - lit ≥ 0.999 的 120 帧：检出自机 0 帧、读出血量 1 帧
 * 门限取 {@link HUD_ABSENT_LIT}=0.97，两侧都有余量。
 *
 * 下界 {@link DEAD_SCOREBOARD_MIN_LIT} 挡的是另一头：黑屏、丢帧、流中断，
 * 它们的亮像素占比是 0，不能当成「HUD 在但灰了」。
 */
export function hudPresent(lit: number): boolean {
  return lit >= DEAD_SCOREBOARD_MIN_LIT && lit < HUD_ABSENT_LIT;
}

/** 判相所需的三个量。抽成参数是为了让调用方只算一次，也让本函数不碰像素、可单测。 */
export interface PhaseSignals {
  /** 记分板区域亮像素占比 */
  lit: number;
  /** 记分板区域阵营色占比 */
  sat: number;
  /** readHp 的结果。null = 没读出合法的「当前/上限」 */
  hp: HpReading | null;
}

/**
 * 地面路自判。
 *
 * 阵亡有**两种**像素形态，缺一不可：
 *   1. 整体灰化 —— 赛事 UI 仍在渲染但被抽掉颜色，小地图变黑白、血条被
 *      「收起该面板」的模块面板顶掉，因而 readHp 失败。实测 sat 精确塌到 0.000。
 *   2. 彩色 HUD + 血量归零 —— UI 还是彩的、小地图照常可读，但血量是 `0 / 300`。
 *      这一种下血条本身没有填充，所以血条阵营色占比同样是 0。
 *
 * 早先只认第 1 种、并且拿「血条上还有没有阵营色」当开播判据，第 2 种就会被
 * 误判成「没开播」而整帧丢弃 —— 而那恰恰是小地图完全可读的时刻。
 */
export function groundPhase(s: PhaseSignals): StreamPhase {
  if (!hudPresent(s.lit)) return 'off';
  if (s.sat < DEAD_SCOREBOARD_SAT) return 'dead'; // 形态 1：整体灰化
  if (s.hp && s.hp.current === 0) return 'dead'; // 形态 2：彩色 HUD，血量归零
  return 'live';
}

/**
 * 空中路自判。
 *
 * 空中路**没有任何 HUD** —— 没有血条、没有记分板，那两块 ROI 落在 FPV 画面本身
 * （实测记分板区域是一条近黑的边带）。所以这里只能判「是不是被一张全亮的画面盖住了」，
 * 判不了「HUD 在不在」，更判不了阵亡（空中机器人没有血量，见 tracker 的 HAS_HP）。
 *
 * 于是 'live' 在空中路上只意味着**「可以试着读」**：真正的存在性判据是小地图上
 * 有没有检出自机，检不到就是 unknown，不是阵亡。
 *
 * 实测 84 帧空中样本：检出自机的 23 帧 lit 全为 0.000；lit ≥ 0.999 的 31 帧
 * 检出自机 0 帧。分离干净，但要说清它**靠的是空中机位顶部恰好有一条暗带**，
 * 属于取景的巧合而非设计出来的信号 —— 换了机位构图就得重标。
 */
export function dronePhase(lit: number): StreamPhase {
  return lit >= HUD_ABSENT_LIT ? 'off' : 'live';
}

/**
 * 一帧的自判 + 血量读数，单一入口。
 *
 * 顺序是有意的：先用最便宜的 lit 把「没有 HUD」筛掉，再去读血量。
 * 对一张转播照片跑数字切分不只是白费 —— 照片上的高对比边缘会产出大量候选块，
 * 那是整条链路里最慢的一步，而结果注定被丢弃。
 */
export function observePhase(
  frame: Frame,
  kind: StreamKind,
): { phase: StreamPhase; hp: HpReading | null } {
  const lit = scoreboardLit(frame);
  // 空中路的 hp 恒为 null，这是**定义**不是「还没读到」：空中机器人没有血量，
  // 那一路也没有血条。对它调 readHp 不是读不准，是问了一个不存在的问题 ——
  // 任何非 null 的返回都是凭空捏造。readHp 的格式校验目前恰好挡住了全部捏造
  // （实测 0%），但那是运气不是设计，所以在这里就不问。
  if (kind === 'drone') return { phase: dronePhase(lit), hp: null };
  if (!hudPresent(lit)) return { phase: 'off', hp: null };
  const hp = readHp(frame);
  return { phase: groundPhase({ lit, sat: scoreboardSaturation(frame), hp }), hp };
}
