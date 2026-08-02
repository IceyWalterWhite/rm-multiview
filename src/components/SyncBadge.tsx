import { useSyncExternalStore } from 'react';
import type { StreamStatus } from '../sync/engine';

// 机位角标的状态源：SyncEngine 满足此结构（statusOf 引用稳定 + 变化通知）
export interface StatusSource {
  subscribeChange(fn: () => void): () => void;
  statusOf(id: string): StreamStatus;
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
  if (status.mode === 'off' || status.mode === 'synced') return null;
  return (
    <span className="sync-badge" role="status">
      {status.mode === 'edge' ? '等待直播' : `同步 ${fmt(status.error ?? 0)}`}
    </span>
  );
}
