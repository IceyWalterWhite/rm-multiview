import { useState } from 'react';
import type { Danmaku, StreamView } from '../types';
import type { QualityLabel } from '../config';
import { VideoPlayer } from './VideoPlayer';
import { DanmakuOverlay } from './DanmakuOverlay';
import { srcForQuality } from '../data/streams';

export function MainStage({ main, quality, messages, onSignatureExpired }: { main: StreamView; quality: QualityLabel; messages: Danmaku[]; onSignatureExpired?: () => void }) {
  const [muted, setMuted] = useState(true); // 静音起播以满足浏览器自动播放策略；用户点击后解锁音频
  return (
    <div className="main-stage">
      <span className="main-res">主视角 {quality}</span>
      <button className="mute-btn" onClick={() => setMuted((m) => !m)}>{muted ? '🔇 点击开启声音' : '🔊 静音'}</button>
      <VideoPlayer src={srcForQuality(main, quality)} muted={muted} className="main-video" onSignatureExpired={onSignatureExpired} />
      <DanmakuOverlay messages={messages} />
    </div>
  );
}
