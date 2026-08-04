import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ZoneCatalog, Profile } from './types';
import type { DanmakuConnection } from './net/leancloud';
import { useProfile } from './hooks/useProfile';
import { useCatalog } from './hooks/useCatalog';
import { useDanmaku, makeLiveConnFactory } from './hooks/useDanmaku';
import { useCheer } from './hooks/useCheer';
import { DEFAULT_MAIN_QUALITY, DEFAULT_MULTI_QUALITY, type QualityLabel } from './config';
import { LiveStage } from './components/LiveStage';
import { CheerBar } from './components/CheerBar';
import { ChatSection } from './components/ChatSection';
import { IdentityEditor } from './components/IdentityEditor';
import { OfflineView } from './components/OfflineView';

export default function App() {
  const { state, refresh } = useCatalog();
  const [mainQuality, setMainQuality] = useState<QualityLabel>(DEFAULT_MAIN_QUALITY);
  const [multiQuality, setMultiQuality] = useState<QualityLabel>(DEFAULT_MULTI_QUALITY);
  const [editing, setEditing] = useState(false);
  const { profile, setProfile, isComplete } = useProfile();

  const chatRoomId = state.status === 'live' ? state.catalog.chatRoomId : null;
  const connFactory = useMemo(
    () => (chatRoomId ? makeLiveConnFactory(chatRoomId) : null),
    [chatRoomId],
  );

  // 原始错误只进控制台（用户看友好文案）；放 effect 里，进入 error 态时打一条而非每次渲染都打
  const errMessage = state.status === 'error' ? state.message : null;
  useEffect(() => {
    if (errMessage !== null) console.error('[App] catalog load failed:', errMessage);
  }, [errMessage]);

  if (state.status === 'loading') return <div className="loading">直播加载中…</div>;
  if (state.status === 'ended') return <OfflineView />;
  if (state.status === 'error') {
    return (
      <div className="fatal">
        <div>
          <p>⚠ 直播信息加载失败，请检查网络后重试</p>
          <button className="send-btn" onClick={() => location.reload()}>重试</button>
        </div>
      </div>
    );
  }
  if (state.status !== 'live') return null;
  // connFactory 为 null（赛区无聊天室，如搭建直播）也照常渲染画面，弹幕降级隐藏——
  // 2026-07-28 曾因这里 return null 造成整站白屏
  return (
    <Live
      catalog={state.catalog} connFactory={connFactory} onSignatureExpired={refresh}
      mainQuality={mainQuality} multiQuality={multiQuality}
      setMainQuality={setMainQuality} setMultiQuality={setMultiQuality}
      profile={profile} setProfile={setProfile} isComplete={isComplete}
      editing={editing} setEditing={setEditing}
    />
  );
}

interface LiveProps {
  catalog: ZoneCatalog;
  connFactory: (() => Promise<DanmakuConnection>) | null;
  onSignatureExpired: () => void;
  mainQuality: QualityLabel; multiQuality: QualityLabel;
  setMainQuality: (q: QualityLabel) => void; setMultiQuality: (q: QualityLabel) => void;
  profile: Profile; setProfile: (p: Profile) => void; isComplete: boolean;
  editing: boolean; setEditing: (b: boolean) => void;
}

function Live(props: LiveProps) {
  const { catalog, connFactory, profile, setEditing } = props;
  const danmakuEnabled = connFactory !== null;
  const { messages, status, send } = useDanmaku(connFactory);
  const cheer = useCheer(catalog);
  const cheerSlot = cheer.visible ? (
    <CheerBar
      redVotes={cheer.redVotes}
      blueVotes={cheer.blueVotes}
      redLabel={cheer.redLabel}
      blueLabel={cheer.blueLabel}
      canVote={false}
      officialUrl=""
      error={cheer.error}
    />
  ) : null;
  // Live 每批弹幕都重渲染；回调引用稳定，DanmakuComposer/QualityControls 的 memo 才有效
  const onSend = useCallback((text: string) => send(text, profile), [send, profile]);
  const onEditIdentity = useCallback(() => setEditing(true), [setEditing]);
  const onCloseEditor = useCallback(() => setEditing(false), [setEditing]);
  return (
    <div className="app">
      {danmakuEnabled && status !== 'connected' && (
        <div className="conn-status">{status === 'reconnecting' ? '弹幕重连中…' : '弹幕连接中…'}</div>
      )}
      <LiveStage
        catalog={catalog} messages={messages} danmakuEnabled={danmakuEnabled}
        cheerSlot={cheerSlot}
        mainQuality={props.mainQuality} multiQuality={props.multiQuality}
        setMainQuality={props.setMainQuality} setMultiQuality={props.setMultiQuality}
        profile={profile} isComplete={props.isComplete}
        onSend={onSend} onEditIdentity={onEditIdentity}
        onSignatureExpired={props.onSignatureExpired}
      />
      <ChatSection
        zoneName={catalog.zoneName} messages={messages} danmakuEnabled={danmakuEnabled}
        profile={profile} isComplete={props.isComplete}
        onSend={onSend} onEditIdentity={onEditIdentity}
      />
      {/* 常驻挂载、open 驱动开合：原生 dialog 的关闭动画（allow-discrete）需要元素还在 DOM 里才播得完 */}
      <IdentityEditor open={props.editing} value={props.profile} onSave={props.setProfile} onClose={onCloseEditor} />
    </div>
  );
}
