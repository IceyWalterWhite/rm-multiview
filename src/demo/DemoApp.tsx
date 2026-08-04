import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_MAIN_QUALITY, DEFAULT_MULTI_QUALITY, type QualityLabel } from '../config';
import { CheerBar } from '../components/CheerBar';
import { ChatSection } from '../components/ChatSection';
import { IdentityEditor } from '../components/IdentityEditor';
import { LiveStage } from '../components/LiveStage';
import { useDanmaku } from '../hooks/useDanmaku';
import { useProfile } from '../hooks/useProfile';
import { demoCatalog, demoCheer, makeDemoConnFactory } from './demoData';

export default function DemoApp({ state }: { state?: string }) {
  void state;
  const [mainQuality, setMainQuality] = useState<QualityLabel>(DEFAULT_MAIN_QUALITY);
  const [multiQuality, setMultiQuality] = useState<QualityLabel>(DEFAULT_MULTI_QUALITY);
  const [editing, setEditing] = useState(false);
  const [votes, setVotes] = useState(() => ({ red: demoCheer.baseRed, blue: demoCheer.baseBlue }));
  const { profile, setProfile, isComplete } = useProfile();
  const connFactory = useMemo(() => makeDemoConnFactory(), []);
  const { messages, status, send } = useDanmaku(connFactory);
  const onSend = useCallback((text: string) => send(text, profile), [send, profile]);
  const onEditIdentity = useCallback(() => setEditing(true), []);
  const onCloseEditor = useCallback(() => setEditing(false), []);

  useEffect(() => {
    const id = setInterval(() => {
      setVotes(({ red, blue }) => ({ red: red + 8, blue: blue + 5 }));
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app">
      {status !== 'connected' && <div className="conn-status">{status === 'reconnecting' ? '弹幕重连中…' : '弹幕连接中…'}</div>}
      <LiveStage
        catalog={demoCatalog}
        messages={messages}
        danmakuEnabled
        mainQuality={mainQuality}
        multiQuality={multiQuality}
        setMainQuality={setMainQuality}
        setMultiQuality={setMultiQuality}
        profile={profile}
        isComplete={isComplete}
        onSend={onSend}
        onEditIdentity={onEditIdentity}
        cheerSlot={(
          <CheerBar
            redVotes={votes.red}
            blueVotes={votes.blue}
            redLabel={demoCheer.redLabel}
            blueLabel={demoCheer.blueLabel}
            canVote={false}
            officialUrl={demoCheer.officialUrl}
          />
        )}
      />
      <ChatSection
        zoneName={demoCatalog.zoneName}
        messages={messages}
        danmakuEnabled
        profile={profile}
        isComplete={isComplete}
        onSend={onSend}
        onEditIdentity={onEditIdentity}
      />
      <IdentityEditor open={editing} value={profile} onSave={setProfile} onClose={onCloseEditor} />
    </div>
  );
}
