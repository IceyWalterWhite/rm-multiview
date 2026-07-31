import type { Danmaku, Profile } from '../types';
import { ReservedPanel } from './ReservedPanel';
import { ChatRoom } from './ChatRoom';
import { IcpFooter } from './IcpFooter';

interface Props {
  zoneName: string; messages: Danmaku[]; profile: Profile; isComplete: boolean;
  danmakuEnabled: boolean;
  onSend: (t: string) => Promise<void> | void; onEditIdentity: () => void;
}

export function ChatSection(p: Props) {
  return (
    // id=community：第一屏「聊天室 · 社区工具 ↓」路标的滚动锚点
    <section className="chat-section" id="community" aria-label="聊天与社区">
      <ReservedPanel />
      <ChatRoom zoneName={p.zoneName} messages={p.messages} profile={p.profile} isComplete={p.isComplete} danmakuEnabled={p.danmakuEnabled} onSend={p.onSend} onEditIdentity={p.onEditIdentity} />
      <IcpFooter />
    </section>
  );
}
