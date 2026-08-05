/**
 * 开赛检测。独立模块 —— 沙盘、sync（多路同步校准）共用同一份判定，避免各写一套判据后互相打架。
 *
 * 三层：
 *   observe.ts   把一帧像素/一窗音频压成标量观测（纯函数）
 *   signals.ts   把多路观测汇总成一条证据，音频优先、视觉兜底（纯函数）
 *   detector.ts  带迟滞的状态机，时间由调用方注入（纯 reducer）
 *
 * sync 接入约定（届时由 sync 侧 import 本模块）：
 *   sync 的 audioCalib 已产出解码 PCM → rmsDbFromSamples(samples) → StreamObservation
 *   → classify() 做单次判定，或 createMatchLiveDetector() 拿带迟滞的持续状态。
 *   音频来自 hls.js fLoader 分片字节（teeLoader/tsDemux），与多路 muted 播放完全隔离。
 *
 * 判据强度实测（2026 复活赛第 30 场录屏，全场 2570s）：
 *   音频 —— 等待卡与回合间歇是数字静音(-120dB)，回合中 p50=-30dB，边界无抖动
 *   视觉 —— 血条阵营色占比，与「文字是否存在」这一独立信号一致率 95.97%
 */
export { classify, SILENCE_DBFS } from './signals';
export { reduce, createMatchLiveDetector, type MatchLiveDetector } from './detector';
export { barSaturationFromFrame, rmsDbFromSamples } from './observe';
export {
  DEFAULT_DETECTOR_OPTIONS,
  initialState,
  type DetectorOptions,
  type DetectorState,
  type Evidence,
  type EvidenceSource,
  type MatchPhase,
  type StreamObservation,
} from './types';
