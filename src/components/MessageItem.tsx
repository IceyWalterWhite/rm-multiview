import type { Danmaku } from '../types';
import { identityTag, danmakuColor } from '../data/danmaku';
import { ANNIVERSARY_BADGE } from '../config';

export function MessageItem({ d }: { d: Danmaku }) {
  const color = danmakuColor(d);
  return (
    <div className="msg-item">
      <span className="msg-name" style={{ color }}>
        {d.badge === ANNIVERSARY_BADGE && <i className="msg-badge" data-testid="badge" title="十周年徽章" />}
        <span className="msg-tag" style={{ color }}>{identityTag(d)}</span>
        <span className="msg-school">{d.schoolName}</span>
        <span className="msg-nick">{d.nickname}</span>
      </span>
      <span className="msg-text">{d.text}</span>
    </div>
  );
}
