import { useEffect, useRef, useState } from 'react';
import type { Danmaku, Profile } from '../types';
import { MessageItem } from './MessageItem';
import { DanmakuComposer } from './DanmakuComposer';
import { dedupeKey } from '../data/danmaku';
import { prefersReducedMotion } from '../a11y';

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
  // 上翻期间到达过新消息 → 显示返航 pill（计数在缓冲截断下不可靠，只报有/无）
  const [hasNew, setHasNew] = useState(false);
  const lastKeyRef = useRef<string | null>(null);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (stickRef.current) setHasNew(false); // 手动滚回底部也算返航
  };
  useEffect(() => {
    const el = listRef.current;
    // 末条 key 变化 = 有新消息（长度差在 300 条环形缓冲截断时恒为 0，不可作依据）
    const last = messages.length ? dedupeKey(messages[messages.length - 1]) : null;
    const changed = last !== null && last !== lastKeyRef.current;
    lastKeyRef.current = last;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    else if (changed) setHasNew(true);
  }, [messages]);

  const jumpToBottom = () => {
    const el = listRef.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    else el.scrollTop = el.scrollHeight; // jsdom 无 scrollTo
    stickRef.current = true;
    setHasNew(false);
  };

  return (
    <div className="chatroom">
      <div className="chatroom-title">聊天室 · {zoneName}</div>
      <div className="chatroom-body">
        <div className="chatroom-list" ref={listRef} onScroll={onScroll} tabIndex={0} role="log" aria-live="off" aria-label={`${zoneName}弹幕`}>
          {/* 同 id 可能因重发出现两次（见 danmaku.ts），key 用三元组合键 */}
          {messages.map((m) => <MessageItem key={dedupeKey(m)} d={m} />)}
        </div>
        {hasNew && <button className="new-msg-pill" onClick={jumpToBottom}>有新消息 ↓</button>}
      </div>
      {danmakuEnabled ? (
        <DanmakuComposer profile={profile} isComplete={isComplete} onSend={onSend} onEditIdentity={onEditIdentity} variant="panel" />
      ) : (
        <div className="chatroom-disabled">本场直播未开启弹幕</div>
      )}
    </div>
  );
}
