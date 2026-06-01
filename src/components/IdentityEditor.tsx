import { useState } from 'react';
import type { Profile } from '../types';
import { ANNIVERSARY_BADGE } from '../config';

const POSITIONS = ['队员', '老队员', '校友'];

export function IdentityEditor({ value, onSave, onClose }: { value: Profile; onSave: (p: Profile) => void; onClose: () => void; }) {
  const [p, setP] = useState<Profile>(value);
  return (
    <div className="id-editor-backdrop" onClick={onClose}>
      <div className="id-editor" onClick={(e) => e.stopPropagation()}>
        <h3>设置发送身份</h3>
        <label>昵称<input value={p.nickname} onChange={(e) => setP({ ...p, nickname: e.target.value })} /></label>
        <label>学校<input value={p.schoolName} onChange={(e) => setP({ ...p, schoolName: e.target.value })} /></label>
        <label>身份
          <select value={p.position} onChange={(e) => setP({ ...p, position: e.target.value })}>
            {POSITIONS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label>参赛年限<input type="number" min={0} value={p.racingAge} onChange={(e) => setP({ ...p, racingAge: Number(e.target.value) || 0 })} /></label>
        <label><input type="checkbox" checked={p.badge === ANNIVERSARY_BADGE} onChange={(e) => setP({ ...p, badge: e.target.checked ? ANNIVERSARY_BADGE : '' })} /> 十周年徽章</label>
        <div className="id-editor-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!p.nickname || !p.schoolName} onClick={() => { onSave(p); onClose(); }}>保存</button>
        </div>
        <p className="id-hint">身份为自填，请文明发言。</p>
      </div>
    </div>
  );
}
