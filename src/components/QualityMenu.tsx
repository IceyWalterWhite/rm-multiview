import { memo, useEffect, useRef, useState } from 'react';
import { QUALITY_LABELS, type QualityLabel } from '../config';

interface Props {
  mainQuality: QualityLabel;
  multiQuality: QualityLabel;
  onMain: (q: QualityLabel) => void;
  onMulti: (q: QualityLabel) => void;
}

function Segmented({ value, onChange, label }: {
  value: QualityLabel;
  onChange: (q: QualityLabel) => void;
  label: string;
}) {
  return (
    <div className="ctl-field">
      <span className="ctl-field__label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {QUALITY_LABELS.map((q) => (
          <button
            key={q}
            className={`seg__opt${value === q ? ' active' : ''}`}
            aria-pressed={value === q}
            onClick={() => onChange(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 画质设置：收进单一入口。
 *
 * 栏上只留一个可点目标 + 一段状态文字（当前两档），设置本身在弹出面板里。
 * 平铺成两个下拉会在观赛屏上多占两个可点目标，而画质是「调一次就不再碰」的东西。
 */
export const QualityMenu = memo(function QualityMenu({ mainQuality, multiQuality, onMain, onMulti }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="ctl-menu" ref={wrapRef}>
      <button
        className="ctl-menu__btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="画质设置"
      >
        <span>画质</span>
        <span className="ctl-menu__cur">{mainQuality} / {multiQuality}</span>
        <span aria-hidden="true" className="ctl-menu__caret">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="ctl-menu__panel" role="dialog" aria-label="画质设置">
          <Segmented value={mainQuality} onChange={onMain} label="主视角" />
          <Segmented value={multiQuality} onChange={onMulti} label="多视角" />
        </div>
      )}
    </div>
  );
});
