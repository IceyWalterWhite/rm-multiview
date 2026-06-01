import { useState } from 'react';
import type { Danmaku, MatchTitle, StreamView } from '../types';
import type { QualityLabel } from '../config';
import { VideoPlayer } from './VideoPlayer';
import { DanmakuOverlay } from './DanmakuOverlay';
import { MatchTitleBar } from './MatchTitleBar';
import { srcForQuality } from '../data/streams';

export function MainStage({ main, quality, titleFallback, matchTitle, messages, onSignatureExpired }: {
  main: StreamView;
  quality: QualityLabel;
  titleFallback: string;
  matchTitle: MatchTitle | null;
  messages: Danmaku[];
  onSignatureExpired?: () => void;
}) {
  const [muted, setMuted] = useState(true); // 静音起播以满足浏览器自动播放策略；用户点击后解锁音频
  return (
    <div className="main-stage">
      <MatchTitleBar text={matchTitle?.text} isNext={matchTitle?.isNext} fallback={titleFallback} />
      <button className="mute-btn" onClick={() => setMuted((m) => !m)} title={muted ? '点击开启声音' : '静音'}>{muted ? '🔇' : '🔊'}</button>
      <VideoPlayer src={srcForQuality(main, quality)} muted={muted} className="main-video" onSignatureExpired={onSignatureExpired} />
      <DanmakuOverlay messages={messages} />
    </div>
  );
}
