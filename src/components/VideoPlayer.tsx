import { memo, useRef } from 'react';
import { useHlsPlayer } from '../hooks/useHlsPlayer';
import type { SyncEngine } from '../sync/engine';

interface Props {
  src?: string;
  muted?: boolean;
  className?: string;
  onSignatureExpired?: () => void;
  keepAliveWhenHidden?: boolean;
  /** 播放态回传：观看时长心跳要求主视角确实在播 */
  onPlayingChange?: (playing: boolean) => void;
  // 时码同步：稳定单例 + 原语，不击穿 memo（binding 对象在渲染内组装，hook 用 ref 接）
  syncEngine?: SyncEngine;
  syncId?: string;
  syncIsMain?: boolean;
  syncTier?: string;
}

function isDemoSource(src?: string): src is string {
  return src?.startsWith('demo:') ?? false;
}

function DemoFeed({ src, className }: Pick<Props, 'src' | 'className'>) {
  const label = src!.slice('demo:'.length).replace(/:retry$/, '');
  const side = label.includes('红方') ? 'red' : label.includes('蓝方') ? 'blue' : 'main';

  return (
    <div className="video-wrap">
      <div className={`demo-feed demo-feed--${side}${className ? ` ${className}` : ''}`}>
        <span className="demo-feed__label">{label}</span>
      </div>
    </div>
  );
}

function HlsVideoPlayer({
  src,
  muted = true,
  className,
  onSignatureExpired,
  keepAliveWhenHidden = false,
  onPlayingChange,
  syncEngine,
  syncId,
  syncIsMain = false,
  syncTier = '',
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const sync = syncEngine && syncId
    ? { engine: syncEngine, id: syncId, isMain: syncIsMain, tier: syncTier }
    : undefined;
  const { error } = useHlsPlayer(ref, src, onSignatureExpired, { keepAliveWhenHidden, sync });
  return (
    <div className="video-wrap">
      <video
        ref={ref}
        className={className}
        muted={muted}
        playsInline
        autoPlay
        onPlay={() => onPlayingChange?.(true)}
        onPause={() => onPlayingChange?.(false)}
        onEnded={() => onPlayingChange?.(false)}
      />
      {error && <div className="video-retry">信号中断 · 重连中…</div>}
    </div>
  );
}

export const VideoPlayer = memo(function VideoPlayer(props: Props) {
  if (isDemoSource(props.src)) return <DemoFeed src={props.src} className={props.className} />;
  return <HlsVideoPlayer {...props} />;
});
