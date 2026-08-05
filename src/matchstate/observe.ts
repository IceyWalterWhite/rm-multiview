import { HP_BAR, TEAM_BLUE, TEAM_RED } from '../rmui/layout';
import { resolveRect, type Frame } from '../vision/frame';
import { fractionInRange } from '../vision/mask';

/**
 * 血条上本方阵营色的像素占比。
 * 用「本方」而不是「任意阵营色」是有意的：读出来的颜色若与该路在 catalog 里的
 * 阵营不符，说明 ROI 漂了或流串了，这一路的数据本就不该采信。
 */
export function barSaturationFromFrame(frame: Frame, side: 'red' | 'blue'): number {
  const rect = resolveRect(HP_BAR, frame.width, frame.height);
  return fractionInRange(frame, rect, side === 'red' ? TEAM_RED : TEAM_BLUE);
}

/**
 * 一窗 PCM 采样的 RMS，单位 dBFS。
 * 全零（等待卡的数字静音）会返回 -Infinity；调用方拿它跟 SILENCE_DBFS 比即可，
 * 不要在这里夹到有限值 —— 「精确静音」与「很轻的声音」是两件事，压平了就丢信息。
 */
export function rmsDbFromSamples(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms === 0 ? -Infinity : 20 * Math.log10(rms);
}
