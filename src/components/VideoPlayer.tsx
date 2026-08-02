import { memo, useRef } from 'react';
import { useHlsPlayer } from '../hooks/useHlsPlayer';
import type { SyncEngine } from '../sync/engine';

interface Props {
  src?: string;
  muted?: boolean;
  className?: string;
  onSignatureExpired?: () => void;
  keepAliveWhenHidden?: boolean;
  // 时码同步：稳定单例 + 原语，不击穿 memo（binding 对象在渲染内组装，hook 用 ref 接）
  syncEngine?: SyncEngine;
  syncId?: string;
  syncIsMain?: boolean;
  syncTier?: string;
}

export const VideoPlayer = memo(function VideoPlayer({ src, muted = true, className, onSignatureExpired, keepAliveWhenHidden = false, syncEngine, syncId, syncIsMain = false, syncTier = '' }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const sync = syncEngine && syncId
    ? { engine: syncEngine, id: syncId, isMain: syncIsMain, tier: syncTier }
    : undefined;
  const { error } = useHlsPlayer(ref, src, onSignatureExpired, { keepAliveWhenHidden, sync });
  return (
    <div className="video-wrap">
      <video ref={ref} className={className} muted={muted} playsInline autoPlay />
      {error && <div className="video-retry">信号中断 · 重连中…</div>}
    </div>
  );
});
