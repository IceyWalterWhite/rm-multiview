import { classify } from './signals';
import {
  DEFAULT_DETECTOR_OPTIONS,
  initialState,
  type DetectorOptions,
  type DetectorState,
  type Evidence,
  type MatchPhase,
  type StreamObservation,
} from './types';

/**
 * 迟滞状态机。做成纯 reducer 是刻意的：
 * 时间由调用方传入，测试就能直接跳时间而不用等真实计时器；
 * 而且另一个实时服务可以只取这个 reducer，不必连带拿走浏览器侧的采样代码。
 */
export function reduce(
  state: DetectorState,
  nowMs: number,
  evidence: Evidence,
  opts: DetectorOptions = DEFAULT_DETECTOR_OPTIONS,
): DetectorState {
  // 没有任何可用观测：冻结在当前判定，并清掉半路的候选。
  // 不清的话，一次长时间断采之后第一个样本就会立刻满足迟滞时长而翻转。
  if (evidence.live === null) {
    return { ...state, pending: null, pendingSince: nowMs, lastSource: 'none' };
  }

  const target: MatchPhase = evidence.live ? 'live' : 'idle';
  if (target === state.phase) {
    return { ...state, pending: null, pendingSince: nowMs, lastSource: evidence.source };
  }
  if (state.pending !== target) {
    return { ...state, pending: target, pendingSince: nowMs, lastSource: evidence.source };
  }

  const need = target === 'live' ? opts.enterLiveAfterMs : opts.enterIdleAfterMs;
  if (nowMs - state.pendingSince >= need) {
    return { phase: target, since: nowMs, pending: null, pendingSince: nowMs, lastSource: evidence.source };
  }
  return { ...state, lastSource: evidence.source };
}

export interface MatchLiveDetector {
  /** 喂一轮多路观测，返回本轮之后的相位。 */
  observe(nowMs: number, observations: StreamObservation[]): MatchPhase;
  readonly state: DetectorState;
}

/** 有状态的薄包装。真正的逻辑都在 reduce 里，这里只负责存住上一帧状态。 */
export function createMatchLiveDetector(
  opts: DetectorOptions = DEFAULT_DETECTOR_OPTIONS,
  startMs = 0,
): MatchLiveDetector {
  let state = initialState(startMs);
  return {
    observe(nowMs, observations) {
      state = reduce(state, nowMs, classify(observations), opts);
      return state.phase;
    },
    get state() {
      return state;
    },
  };
}
