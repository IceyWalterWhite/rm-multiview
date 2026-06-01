import { useEffect, useRef } from 'react';
import type { Danmaku, Profile } from '../types';
import { MessageItem } from './MessageItem';
import { DanmakuComposer } from './DanmakuComposer';

interface Props {
  zoneName: string;
  messages: Danmaku[];
  profile: Profile;
  isComplete: boolean;
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
}

export function ChatRoom({ zoneName, messages, profile, isComplete, onSend, onEditIdentity }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="chatroom">
      <div className="chatroom-title">聊天室 · {zoneName}</div>
      <div className="chatroom-list" ref={listRef}>
        {messages.map((m) => <MessageItem key={m.id} d={m} />)}
      </div>
      <DanmakuComposer profile={profile} isComplete={isComplete} onSend={onSend} onEditIdentity={onEditIdentity} variant="panel" />
    </div>
  );
}
