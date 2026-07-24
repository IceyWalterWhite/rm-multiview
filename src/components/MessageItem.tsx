import { memo } from 'react';
import type { Danmaku } from '../types';
import { identityTag, danmakuColor } from '../data/danmaku';
import { ANNIVERSARY_BADGE } from '../config';

// memo：每批新弹幕到达时列表重渲染，已有的几百条 item 引用未变，直接跳过
export const MessageItem = memo(function MessageItem({ d }: { d: Danmaku }) {
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
});
