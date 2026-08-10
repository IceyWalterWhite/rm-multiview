// 同步控制的纯决策函数：1Hz 采样，主视角为基准（永不干预），
// 每个静音侧路根据误差选择 不动/变速/seek/贴边。所有阈值集中在此。
export const RATE_SLOW = 0.96;
export const RATE_FAST = 1.04;

const DEADBAND_INNER = 0.05; // 收敛判定：进入即停止干预
const DEADBAND_OUTER = 0.15; // 启动判定：超出才开始变速（滞回防边界振荡）
// 变速追平此值以内的误差；更大直接 seek。
// 定在 2 而非更大：±4% 变速每秒只补 0.04s，2s 的误差已经要追 50s，
// 再往上等待时间长得离谱，不如一次跳到位。代价是 seek 会有一次画面跳变。
const SEEK_THRESHOLD = 2;
const BACK_SEEK_LIMIT = 8; // backBufferLength=10，回退留 2s 余量
const MIN_SEEK_GAIN = 2; // 存粮低于此视为贴边（内容尚未产出），交给 edge 等待

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
    // 落后要往前追。
    const ahead = o.bufferedEnd - o.currentTime;
    // ① 存粮见底：直播边缘就在眼前、内容还没产出（真断流）。跳无可跳，贴边等。
    if (ahead < MIN_SEEK_GAIN) return { type: 'edge' };
    // ② 一步跳到目标位置——落点允许在已缓冲区之外。
    //    同步目标恒在 playlist 滑窗内（主视角 lag≈13.5s、offset≈4s → 目标只比
    //    侧路边缘旧 ~9s，滑窗有 15s）。2026-08-07 现网 A/B 对照实测：暂停 35s 后
    //    一步跳出缓冲 47s，hls.js 于 0.2s 内在落点建好 7.2s 新缓冲恢复播放，
    //    seek/waiting 各 1 次；对照组走旧逻辑（变速档 + clamp 到缓冲末端−4s）
    //    则 4 次 seek、4 次画面跳变、3.4s 才收敛。
    //    2026-08-05 的 seek 死循环（落点贴末端只剩 0.5s 存粮 → 播完饿 → 再跳末端）
    //    不会复活：那个循环的本质是落点追着缓冲末端跑，这里的落点是固定的
    //    同步目标，一跳即达，误差归零后没有「再跳一次」。
    return { type: 'seek', to: o.currentTime - o.error };
  }
  // 超前：向后 seek，受回退缓冲约束；残余误差交给后续节拍
  return { type: 'seek', to: Math.max(o.currentTime - o.error, o.currentTime - BACK_SEEK_LIMIT) };
}
