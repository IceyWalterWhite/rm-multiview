import { useState } from 'react';
import type { Danmaku, MatchTitle, StreamView } from '../types';
import type { QualityLabel } from '../config';
import type { SyncEngine } from '../sync/engine';
import { VideoPlayer } from './VideoPlayer';
import { DanmakuOverlay } from './DanmakuOverlay';
import { MatchTitleBar } from './MatchTitleBar';
import { sourceForQuality } from '../data/streams';

export function MainStage({ main, quality, titleFallback, matchTitle, messages, showDanmaku, onSignatureExpired, syncEngine }: {
  main: StreamView;
  quality: QualityLabel;
  titleFallback: string;
  matchTitle: MatchTitle | null;
  messages: Danmaku[];
  showDanmaku: boolean;
  onSignatureExpired?: () => void;
  syncEngine?: SyncEngine;
}) {
  const [muted, setMuted] = useState(true); // 静音起播以满足浏览器自动播放策略；用户点击后解锁音频
  const source = sourceForQuality(main, quality); // 时码同步 tier 按实际源的 label（缺档回退时 ≠ quality）
  return (
    <div className="main-stage">
      <MatchTitleBar text={matchTitle?.text} isNext={matchTitle?.isNext} fallback={titleFallback} />
      <button className="mute-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? '开启声音' : '静音'} aria-pressed={!muted} title={muted ? '点击开启声音' : '静音'}>
        <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
      </button>
      <VideoPlayer
        src={source?.src}
        muted={muted}
        className="main-video"
        onSignatureExpired={onSignatureExpired}
        keepAliveWhenHidden
        syncEngine={syncEngine}
        syncId={main.id}
        syncIsMain
        syncTier={source?.label ?? quality}
      />
      {showDanmaku && <DanmakuOverlay messages={messages} />}
    </div>
  );
}
