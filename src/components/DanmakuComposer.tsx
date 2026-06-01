import { useState } from 'react';
import type { Profile } from '../types';
import { ANNIVERSARY_BADGE } from '../config';
import { identityTag } from '../data/danmaku';

interface Props {
  profile: Profile;
  isComplete: boolean;
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
  variant?: 'bar' | 'panel'; // bar = 第一屏控制栏(横排); panel = 聊天室(身份成一栏，竖排)
}

export function DanmakuComposer({ profile, isComplete, onSend, onEditIdentity, variant = 'bar' }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!isComplete) { onEditIdentity(); return; }
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try { await onSend(t); setText(''); } catch (e) { setErr('发送失败：' + (e instanceof Error ? e.message : String(e))); } finally { setBusy(false); }
  }

  const chip = isComplete
    ? `${profile.schoolName}·${identityTag(profile)}·${profile.nickname}`
    : '设置身份';

  return (
    <div className={`composer composer--${variant}`}>
      <button className="id-chip" onClick={onEditIdentity} title="编辑身份">
        {profile.badge === ANNIVERSARY_BADGE && <i className="chip-badge" />}
        {chip} ✎
      </button>
      <div className="composer-row">
        <input
          className="composer-input"
          placeholder="发一个友善的评论~"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <button className="send-btn" onClick={submit} disabled={busy}>发送</button>
      </div>
      {err && <span className="composer-error" role="alert">{err}</span>}
    </div>
  );
}
