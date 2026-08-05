import { useState, type ReactNode } from 'react';
import type { Danmaku, MatchTitle, StreamView } from '../types';
import type { QualityLabel } from '../config';
import type { SyncEngine } from '../sync/engine';
import { VideoPlayer } from './VideoPlayer';
import { DanmakuOverlay } from './DanmakuOverlay';
import { MatchTitleBar } from './MatchTitleBar';
import { SyncControl } from './SyncControl';
import { sourceForQuality } from '../data/streams';

export function MainStage({ main, quality, titleFallback, matchTitle, messages, showDanmaku, cheerSlot, onSignatureExpired, onPlayingChange, syncEngine, syncOn, onToggleSync, syncTrim, onSyncTrim }: {
  main: StreamView;
  quality: QualityLabel;
  titleFallback: string;
  matchTitle: MatchTitle | null;
  messages: Danmaku[];
  showDanmaku: boolean;
  cheerSlot?: ReactNode;
  onSignatureExpired?: () => void;
  /** 播放态回传：观看时长心跳要求主视角确实在播 */
  onPlayingChange?: (playing: boolean) => void;
  syncEngine?: SyncEngine;
  /** 时码同步开关与微调：控件悬浮在本组件右上角，与静音同处一区 */
  syncOn?: boolean;
  onToggleSync?: () => void;
  syncTrim?: number;
  onSyncTrim?: (sec: number) => void;
}) {
  const [muted, setMuted] = useState(true); // 静音起播以满足浏览器自动播放策略；用户点击后解锁音频
  const source = sourceForQuality(main, quality); // 时码同步 tier 按实际源的 label（缺档回退时 ≠ quality）
  return (
    <div className="main-stage">
      <MatchTitleBar text={matchTitle?.text} isNext={matchTitle?.isNext} fallback={titleFallback} />
      {/* 画面右上角工具区：时码同步紧邻静音。两者都是「对这一路画面本身」的操作，
          放在一起而不是散在底部控制栏——观赛屏不铺控件带 */}
      <div className="stage-tools">
        {onToggleSync && (
          <SyncControl on={syncOn ?? true} onToggle={onToggleSync} trim={syncTrim ?? 0} onTrim={onSyncTrim ?? (() => {})} />
        )}
        <button className="mute-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? '开启声音' : '静音'} aria-pressed={!muted} title={muted ? '点击开启声音' : '静音'}>
          <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
        </button>
      </div>
      <VideoPlayer
        src={source?.src}
        muted={muted}
        className="main-video"
        onSignatureExpired={onSignatureExpired}
        onPlayingChange={onPlayingChange}
        keepAliveWhenHidden
        syncEngine={syncEngine}
        syncId={main.id}
        syncIsMain
        syncTier={source?.label ?? quality}
      />
      {showDanmaku && <DanmakuOverlay messages={messages} />}
      {cheerSlot}
    </div>
  );
}
