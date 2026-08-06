import { useEffect, useRef, useState } from 'react';

export type StageLayout = 'wings' | 'grid';

const LABELS: Record<StageLayout, string> = {
  wings: '经典布局',
  grid: '沙盘布局',
};

/**
 * 布局缩略图。由矩形直接拼出两套布局的骨架，不手绘图标 ——
 * 手绘会让每加一套布局都欠一张图，而这里加一个分支就有图。
 */
function Thumb({ kind }: { kind: StageLayout }) {
  return (
    <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      {kind === 'wings' ? (
        <>
          {[0, 1, 2, 3].map((i) => <rect key={`l${i}`} x="1.5" y={1.5 + i * 5} width="6" height="4" />)}
          <rect x="9.5" y="1.5" width="15" height="19" />
          {[0, 1, 2, 3].map((i) => <rect key={`r${i}`} x="26.5" y={1.5 + i * 5} width="6" height="4" />)}
        </>
      ) : (
        <>
          <rect x="1.5" y="1.5" width="17" height="19" />
          {[0, 1].map((r) => [0, 1].map((c) => (
            <rect key={`${r}${c}`} x={20.5 + c * 6.5} y={1.5 + r * 5} width="5.5" height="4" />
          )))}
          <rect x="20.5" y="12" width="12" height="8.5" strokeDasharray="2 1.5" />
        </>
      )}
    </svg>
  );
}

interface Props {
  value: StageLayout;
  onChange: (v: StageLayout) => void;
}

export function LayoutMenu({ value, onChange }: Props) {
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
        title="切换舞台布局"
      >
        <span>布局</span>
        <span className="ctl-menu__cur">{LABELS[value]}</span>
        <span aria-hidden="true" className="ctl-menu__caret">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="ctl-menu__panel ctl-menu__panel--layout" role="dialog" aria-label="舞台布局">
          {(Object.keys(LABELS) as StageLayout[]).map((k) => (
            <button
              key={k}
              className={`layout-opt${value === k ? ' active' : ''}`}
              aria-pressed={value === k}
              onClick={() => { onChange(k); setOpen(false); }}
            >
              <Thumb kind={k} />
              <span>{LABELS[k]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
