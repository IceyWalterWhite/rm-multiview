import { memo, useRef } from 'react';
import { useHlsPlayer } from '../hooks/useHlsPlayer';

interface Props {
  src?: string;
  muted?: boolean;
  className?: string;
  onSignatureExpired?: () => void;
  keepAliveWhenHidden?: boolean;
  onPlayingChange?: (playing: boolean) => void;
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
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const { error } = useHlsPlayer(ref, src, onSignatureExpired, { keepAliveWhenHidden });
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
