import { useRef } from 'react';
import { useHlsPlayer } from '../hooks/useHlsPlayer';

interface Props { src?: string; muted?: boolean; className?: string; onSignatureExpired?: () => void; }

export function VideoPlayer({ src, muted = true, className, onSignatureExpired }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const { error } = useHlsPlayer(ref, src, onSignatureExpired);
  return (
    <div className="video-wrap">
      <video ref={ref} className={className} muted={muted} playsInline autoPlay />
      {error && <div className="video-retry">信号中断 · 重连中…</div>}
    </div>
  );
}
