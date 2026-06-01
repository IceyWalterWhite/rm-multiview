import { useMemo, useState } from 'react';
import type { ZoneCatalog, Profile } from './types';
import type { DanmakuConnection } from './net/leancloud';
import { useProfile } from './hooks/useProfile';
import { useCatalog } from './hooks/useCatalog';
import { useDanmaku, makeLiveConnFactory } from './hooks/useDanmaku';
import { DEFAULT_MAIN_QUALITY, DEFAULT_MULTI_QUALITY, type QualityLabel } from './config';
import { LiveStage } from './components/LiveStage';
import { ChatSection } from './components/ChatSection';
import { IdentityEditor } from './components/IdentityEditor';

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

  if (state.status === 'loading') return <div className="loading">连接当前直播赛区…</div>;
  if (state.status === 'ended') return <div className="fatal">本场直播已结束</div>;
  if (state.status === 'error') return <div className="fatal">加载失败：{state.message}</div>;
  if (!connFactory) return <div className="loading">连接当前直播赛区…</div>; // unreachable when live; narrows type
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
  connFactory: () => Promise<DanmakuConnection>;
  onSignatureExpired: () => void;
  mainQuality: QualityLabel; multiQuality: QualityLabel;
  setMainQuality: (q: QualityLabel) => void; setMultiQuality: (q: QualityLabel) => void;
  profile: Profile; setProfile: (p: Profile) => void; isComplete: boolean;
  editing: boolean; setEditing: (b: boolean) => void;
}

function Live(props: LiveProps) {
  const { catalog, connFactory } = props;
  const { messages, status, send } = useDanmaku(connFactory);
  const onSend = (text: string) => send(text, props.profile);
  return (
    <div className="app">
      {status !== 'connected' && (
        <div className="conn-status">{status === 'reconnecting' ? '弹幕重连中…' : '弹幕连接中…'}</div>
      )}
      <LiveStage
        catalog={catalog} messages={messages}
        mainQuality={props.mainQuality} multiQuality={props.multiQuality}
        setMainQuality={props.setMainQuality} setMultiQuality={props.setMultiQuality}
        profile={props.profile} isComplete={props.isComplete}
        onSend={onSend} onEditIdentity={() => props.setEditing(true)}
        onSignatureExpired={props.onSignatureExpired}
      />
      <ChatSection
        zoneName={catalog.zoneName} messages={messages}
        profile={props.profile} isComplete={props.isComplete}
        onSend={onSend} onEditIdentity={() => props.setEditing(true)}
      />
      {props.editing && (
        <IdentityEditor value={props.profile} onSave={props.setProfile} onClose={() => props.setEditing(false)} />
      )}
    </div>
  );
}
