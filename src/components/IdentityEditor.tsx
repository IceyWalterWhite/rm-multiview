import { memo, useEffect, useRef, useState } from 'react';
import type { Profile } from '../types';
import { ANNIVERSARY_BADGE } from '../config';

const POSITIONS = ['队员', '老队员', '校友'];

interface Props {
  value: Profile;
  onSave: (p: Profile) => void;
  onClose: () => void;
  /** 常驻挂载 + open 切换驱动原生 dialog 开合：关闭动画（allow-discrete）才有机会播完。
      默认 true 兼容"条件挂载即打开"的旧用法。 */
  open?: boolean;
}

// memo：常驻挂载后随父级弹幕批次重渲染，关着的对话框不该陪跑
export const IdentityEditor = memo(function IdentityEditor({ value, onSave, onClose, open = true }: Props) {
  const [p, setP] = useState<Profile>(value);
  const ref = useRef<HTMLDialogElement>(null);
  // 原生 dialog：focus trap / Esc / ::backdrop 全部免费
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setP(value); // 每次打开都从当前身份出发（常驻挂载后 useState 初值只算一次）
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open, value]);
  const normalized = { ...p, nickname: p.nickname.trim(), schoolName: p.schoolName.trim() };
  const canSave = normalized.nickname !== '' && normalized.schoolName !== '';
  const save = () => {
    if (!canSave) return;
    onSave(normalized);
    onClose();
  };
  return (
    // 点 ::backdrop 时 click target 是 dialog 自身（内容区点击 target 是内层 div）
    <dialog ref={ref} className="id-editor-dialog" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="id-editor">
        <h3>设置发送身份</h3>
        <label>昵称<input value={p.nickname} onChange={(e) => setP({ ...p, nickname: e.target.value })} /></label>
        <label>学校<input value={p.schoolName} onChange={(e) => setP({ ...p, schoolName: e.target.value })} /></label>
        {/* 徽章开关与身份下拉同处一行：本行右侧有富余，徽章原本独占一行只是白占高度 */}
        <div className="id-editor-row">
          <label htmlFor="id-position">身份</label>
          <div className="id-editor-control">
            <label className="badge-toggle"><input type="checkbox" checked={p.badge === ANNIVERSARY_BADGE} onChange={(e) => setP({ ...p, badge: e.target.checked ? ANNIVERSARY_BADGE : '' })} /> 十周年徽章</label>
            <select id="id-position" value={p.position} onChange={(e) => setP({ ...p, position: e.target.value })}>
              {POSITIONS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
        </div>
        <label>参赛年限<input type="number" min={0} value={p.racingAge} onChange={(e) => setP({ ...p, racingAge: Number(e.target.value) || 0 })} /></label>
        <div className="id-editor-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!canSave} onClick={save}>保存</button>
        </div>
        <p className="id-hint">身份为自填，请文明发言。</p>
      </div>
    </dialog>
  );
});
