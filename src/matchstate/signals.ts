import { HUD_PRESENT_BAR_SAT } from '../rmui/layout';
import type { Evidence, StreamObservation } from './types';

/**
 * 音频静音判据（dBFS）。
 *
 * 实测：等待卡与回合间歇，FPV 路的音轨是**数字静音** —— 采样值恒为 0，RMS 落到 -120dB
 * （即 log 的下限），而非「很安静」。回合进行中 p50≈-30dB、p95≈-19.5dB。
 * 两者之间有 60dB 以上的空档，所以这个阈值放哪儿都行，取 -70 纯粹是留足余量：
 * MSE 解码链路上可能混入微量抖动，不能假定解出来还是精确的 0。
 */
export const SILENCE_DBFS = -70;

/** 有音频可用的路里，只要有一路出声就算回合进行中 —— 等待卡是所有路同时静音的。 */
function fromAudio(observations: StreamObservation[]): Evidence | null {
  const withAudio = observations.filter((o) => o.audioDb !== null);
  if (withAudio.length === 0) return null;
  const sounding = withAudio.filter((o) => (o.audioDb as number) > SILENCE_DBFS);
  return { live: sounding.length > 0, source: 'audio', sampled: withAudio.length };
}

/**
 * 视觉兜底：血条上还有没有阵营色。
 * 实测非比赛时段 ≤0.001、比赛中最低 0.147（濒死 20/200），可分性很好但不如音频，
 * 所以只在完全拿不到音频时才用。拿不到音频的情形：Safari 原生 HLS 绕过 hls.js，
 * fLoader 不触发，分片字节路径整条断掉 —— 同时 canvas 也被跨源污染（见 useHlsPlayer 的
 * canPlayType 分支），两个信号都没有，状态机保持原状而不是乱翻。
 */
function fromVisual(observations: StreamObservation[]): Evidence | null {
  const withPixels = observations.filter((o) => o.barSaturation !== null);
  if (withPixels.length === 0) return null;
  const lit = withPixels.filter((o) => (o.barSaturation as number) >= HUD_PRESENT_BAR_SAT);
  // 与音频同一个量词：**任意一路**亮着就算进行中。
  //
  // 原先是「过半」，2026-08-04 现网实测否决：一方被团灭时亮着的路数必然不到一半，
  // 而那恰恰是沙盘最该工作的时刻。抓的 45 轮里逐轮亮着的路数是
  //     3 2 3 4 4 4 5 5 5 5 5 5 4 4 5 5 5 4 4 4 4 4 4 4 4 4 8 6 6 5 3 1 0 0 …
  // 第 26 轮的 8 是新回合全员复活，随后逐个阵亡，第 32 轮起持续为 0 = 回合结束。
  // 「过半」只认出 42.2% 的轮次；「任意一路」给出 71.1% = 32/45，与上面这条曲线
  // 逐轮吻合 —— 前 32 轮进行中、后 13 轮回合间歇。
  //
  // 顺带解决了分母被稀释的问题：无人机那两路的血条不在地面机型的位置上，
  // barSaturation 恒低，算进分母只会把「过半」推得更难达成。用「任意」就与分母无关了。
  //
  // 敢用「任意」是因为血条上的阵营色只在回合内出现（非比赛时段实测 ≤0.001，
  // 门限 0.03 有 30 倍余量），加上状态机本身还有迟滞，单帧噪声翻不动它。
  return { live: lit.length > 0, source: 'visual', sampled: withPixels.length };
}

/**
 * 汇总多路观测为一条证据。音频优先 —— 它是无抖动的二值信号，视觉只是兜底。
 * 没有任何可用观测时返回 live=null，交由状态机保持原状。
 */
export function classify(observations: StreamObservation[]): Evidence {
  return fromAudio(observations) ?? fromVisual(observations) ?? { live: null, source: 'none', sampled: 0 };
}
