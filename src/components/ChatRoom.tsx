import { useEffect, useRef } from 'react';
import type { Danmaku, Profile } from '../types';
import { MessageItem } from './MessageItem';
import { DanmakuComposer } from './DanmakuComposer';
import { dedupeKey } from '../data/danmaku';

interface Props {
  zoneName: string;
  messages: Danmaku[];
  profile: Profile;
  isComplete: boolean;
  danmakuEnabled?: boolean; // false = 本场无聊天室，输入区换降级提示
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
}

export function ChatRoom({ zoneName, messages, profile, isComplete, danmakuEnabled = true, onSend, onEditIdentity }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  // 贴底才跟随：用户上翻看历史时，新消息不能把列表拽回底部
  const stickRef = useRef(true);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="chatroom">
      <div className="chatroom-title">聊天室 · {zoneName}</div>
      <div className="chatroom-list" ref={listRef} onScroll={onScroll} tabIndex={0} role="log" aria-live="off" aria-label={`${zoneName}弹幕`}>
        {/* 同 id 可能因重发出现两次（见 danmaku.ts），key 用三元组合键 */}
        {messages.map((m) => <MessageItem key={dedupeKey(m)} d={m} />)}
      </div>
      {danmakuEnabled ? (
        <DanmakuComposer profile={profile} isComplete={isComplete} onSend={onSend} onEditIdentity={onEditIdentity} variant="panel" />
      ) : (
        <div className="chatroom-disabled">本场直播未开启弹幕</div>
      )}
    </div>
  );
}
