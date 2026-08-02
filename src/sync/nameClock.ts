// 阿里云切片器的分片命名 {unix秒}_{seq}.ts：unix 秒是分片写盘时刻的服务器墙钟，
// 与真实墙钟 1:1 推进（2026-08-01 六路×100s 实测零漂移），但每路带一个常量偏差 δ
// （转码/切片管线延迟，由 audioCalib 校准）。此处只负责把名字钟解析成流的「纪元」E：
//   wall(currentTime) = E + currentTime，E = median(名字秒 − frag.start)
export interface FragName {
  wallSec: number;
  seq: number;
}

// 10 位 unix 秒 + 序号；查询串可有可无
const NAME_RE = /(\d{10})_(\d+)\.ts(?:\?|#|$)/;

export function parseFragName(url: string): FragName | null {
  const m = NAME_RE.exec(url);
  if (!m) return null;
  return { wallSec: Number(m[1]), seq: Number(m[2]) };
}

// 名字钟只有 1 秒分辨率，且 hls 重建瞬间可能混入错位样本 → 中位数
export function estimateEpoch(
  samples: ReadonlyArray<{ wallSec: number; fragStart: number }>,
): number | null {
  if (samples.length === 0) return null;
  const diffs = samples.map((s) => s.wallSec - s.fragStart).sort((a, b) => a - b);
  const mid = diffs.length >> 1;
  return diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
}
