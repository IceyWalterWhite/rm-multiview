// 同步控制的纯决策函数：1Hz 采样，主视角为基准（永不干预），
// 每个静音侧路根据误差选择 不动/变速/seek/贴边。所有阈值集中在此。
export const RATE_SLOW = 0.96;
export const RATE_FAST = 1.04;

const DEADBAND_INNER = 0.05; // 收敛判定：进入即停止干预
const DEADBAND_OUTER = 0.15; // 启动判定：超出才开始变速（滞回防边界振荡）
const SEEK_THRESHOLD = 3; // 变速追平此值以内的误差；更大直接 seek
const BACK_SEEK_LIMIT = 8; // backBufferLength=10，回退留 2s 余量
const EDGE_MARGIN = 0.5; // 前向 seek 距缓冲末端的安全距离
const MIN_SEEK_GAIN = 2; // 前方缓冲不足此值时不值得 seek → 贴边等待

export interface SyncObservation {
  /** wall_side − target：正 = 此路画面超前（要等），负 = 落后（要追） */
  error: number;
  currentTime: number;
  bufferedEnd: number;
  /** 上一拍是否正在变速（滞回用） */
  adjusting: boolean;
}

export type SyncAction =
  | { type: 'none' }
  | { type: 'rate'; rate: number }
  | { type: 'seek'; to: number }
  | { type: 'edge' };

export function decide(o: SyncObservation): SyncAction {
  const abs = Math.abs(o.error);
  if (abs < DEADBAND_INNER) return { type: 'none' };
  if (abs < DEADBAND_OUTER && !o.adjusting) return { type: 'none' };
  if (abs <= SEEK_THRESHOLD) {
    return { type: 'rate', rate: o.error > 0 ? RATE_SLOW : RATE_FAST };
  }
  if (o.error < 0) {
    // 落后：向前 seek，受缓冲末端约束；前方无货就贴边等内容产出
    const reachable = o.bufferedEnd - EDGE_MARGIN;
    if (reachable - o.currentTime < MIN_SEEK_GAIN) return { type: 'edge' };
    return { type: 'seek', to: Math.min(o.currentTime - o.error, reachable) };
  }
  // 超前：向后 seek，受回退缓冲约束；残余误差交给后续节拍
  return { type: 'seek', to: Math.max(o.currentTime - o.error, o.currentTime - BACK_SEEK_LIMIT) };
}
