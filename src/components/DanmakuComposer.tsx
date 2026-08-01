import { memo, useState, type ReactNode } from 'react';
import type { Profile } from '../types';
import { ANNIVERSARY_BADGE } from '../config';
import { identityTag } from '../data/danmaku';

interface Props {
  profile: Profile;
  isComplete: boolean;
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
  variant?: 'bar' | 'panel'; // bar = 第一屏控制栏(横排); panel = 聊天室(身份成一栏，竖排)
  leading?: ReactNode; // 输入条内的前置控件（如弹幕开关），B 站式：开关与输入框同框
}

export const DanmakuComposer = memo(function DanmakuComposer({ profile, isComplete, onSend, onEditIdentity, variant = 'bar', leading }: Props) {
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
      {leading}
      <button className="id-chip" onClick={onEditIdentity} title="编辑身份">
        {profile.badge === ANNIVERSARY_BADGE && <i className="chip-badge" />}
        {chip} <span aria-hidden="true">✎</span>
      </button>
      <div className="composer-row">
        <input
          className="composer-input"
          placeholder="发一个友善的评论~"
          enterKeyHint="send"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 中文输入法里 Enter 是「确认候选词」（isComposing），不能当发送
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
        />
        <button className="send-btn" onClick={submit} disabled={busy}>发送</button>
      </div>
      {err && <span className="composer-error" role="alert">{err}</span>}
    </div>
  );
});
