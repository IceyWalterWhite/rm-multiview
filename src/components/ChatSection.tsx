import type { Danmaku, Profile } from '../types';
import { ReservedPanel } from './ReservedPanel';
import { ChatRoom } from './ChatRoom';
import { IcpFooter } from './IcpFooter';

interface Props {
  zoneName: string; messages: Danmaku[]; profile: Profile; isComplete: boolean;
  onSend: (t: string) => Promise<void> | void; onEditIdentity: () => void;
}

export function ChatSection(p: Props) {
  return (
    <section className="chat-section" aria-label="聊天与社区">
      <ReservedPanel />
      <ChatRoom zoneName={p.zoneName} messages={p.messages} profile={p.profile} isComplete={p.isComplete} onSend={p.onSend} onEditIdentity={p.onEditIdentity} />
      <IcpFooter />
    </section>
  );
}
