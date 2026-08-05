/** 比赛是否正在进行。刻意只有两态 —— 消费方（沙盘、以及其它实时服务）要的就是一个开关。 */
export type MatchPhase = 'idle' | 'live';

/** 单路视角在某一时刻的观测。两个字段都允许为 null：拿不到就是拿不到，不要编造。 */
export interface StreamObservation {
  streamId: string;
  /**
   * 音频 RMS，dBFS。null = 没接解码链或当前拿不到采样。
   * 浏览器端来自 hls.js fLoader 分片字节 → tsDemux → OfflineAudioContext 解码（与播放静音
   * 完全隔离，muted 只是播放端开关）；服务端直接拉流解包。同一份 Float32Array 喂进来即可。
   * 只能传 FPV 路 —— 导播主视角全程有解说（实测 p5=-33dB 从不静音），拿它判开赛必然恒真。
   */
  audioDb: number | null;
  /** 左下血条上阵营色像素占比。null = canvas 被污染读不到像素。 */
  barSaturation: number | null;
}

/** 判定依据的来源，供 UI 显示「凭什么这么判」，也便于排障。 */
export type EvidenceSource = 'audio' | 'visual' | 'none';

export interface Evidence {
  /** null = 完全没有可用观测，此时状态机保持原状而不是翻转。 */
  live: boolean | null;
  source: EvidenceSource;
  /** 参与判定的路数，用于诊断。 */
  sampled: number;
}

export interface DetectorOptions {
  /** 证据转为「进行中」后需持续多久才真正切换。 */
  enterLiveAfterMs: number;
  /**
   * 证据转为「未开赛」后需持续多久才真正切换。刻意比上面长：
   * 回合中途误判成未开赛会让沙盘整个消失，比晚几秒收场难受得多。
   */
  enterIdleAfterMs: number;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  enterLiveAfterMs: 2_000,
  enterIdleAfterMs: 8_000,
};

export interface DetectorState {
  phase: MatchPhase;
  /** 当前 phase 的确立时刻（ms）。 */
  since: number;
  /** 正在等待确认的相反相位；null = 证据与当前 phase 一致。 */
  pending: MatchPhase | null;
  pendingSince: number;
  lastSource: EvidenceSource;
}

export function initialState(nowMs = 0): DetectorState {
  return { phase: 'idle', since: nowMs, pending: null, pendingSince: nowMs, lastSource: 'none' };
}
