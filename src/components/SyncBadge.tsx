import { useSyncExternalStore } from 'react';
import type { StreamStatus } from '../sync/engine';

// 机位角标的状态源：SyncEngine 满足此结构（statusOf 引用稳定 + 变化通知）
export interface StatusSource {
  subscribeChange(fn: () => void): () => void;
  statusOf(id: string): StreamStatus;
  /** 比赛是否进行中；null = 判不出来。缺省实现视为「未知」，行为等同赛间 */
  isMatchLive?(): boolean | null;
}

// 用 U+2212 数学负号（视觉宽度与 + 对称，UI 数字排版惯例）
function fmt(sec: number): string {
  const v = Math.abs(sec).toFixed(1);
  return `${sec < 0 ? '−' : '+'}${v}s`;
}

// 追赶期临时角标：只在偏差被主动修正时出现，收敛即消失——瞬态状态不占常驻 UI。
// pointer-events:none（样式层保证），不挡机位的放大点击。
export function SyncBadge({ source, id }: { source: StatusSource; id: string }) {
  const status = useSyncExternalStore(
    (fn) => source.subscribeChange(fn),
    () => source.statusOf(id),
  );
  // 赛间不挂角标：垫片阶段各路本就不同步，把误差摆出来纯属噪音。
  // 判不出来（null）时同样不挂——宁可少显示，不误导。
  const live = useSyncExternalStore(
    (fn) => source.subscribeChange(fn),
    () => source.isMatchLive?.() ?? null,
  );
  if (live !== true) return null;
  if (status.mode === 'off' || status.mode === 'synced') return null;
  return (
    <span className="sync-badge" role="status">
      {/* edge = 落后了但缓冲不够、追不上，只能贴着直播边缘等新分片。
          旧文案「等待直播」会被读成「等比赛开始」，与本角标的含义完全无关 */}
      {status.mode === 'edge' ? '缓冲中' : `同步 ${fmt(status.error ?? 0)}`}
    </span>
  );
}
