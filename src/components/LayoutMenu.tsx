import { useEffect, useRef, useState } from 'react';

export type StageLayout = 'wings' | 'grid';

const LABELS: Record<StageLayout, string> = {
  wings: '两翼',
  grid: '主视角 + 网格 · 沙盘',
};

/**
 * 布局缩略图。由矩形直接拼出两套布局的骨架，不手绘图标 ——
 * 手绘会让每加一套布局都欠一张图，而这里加一个分支就有图。
 */
function Thumb({ kind }: { kind: StageLayout }) {
  const line = 'currentColor';
  return (
    <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden="true" fill="none" stroke={line} strokeWidth="1">
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
    <div className="layout-menu" ref={wrapRef}>
      <button
        className="pill layout-menu__btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="切换舞台布局"
      >
        布局 <span className="layout-menu__cur">{LABELS[value]}</span>
        <span aria-hidden="true">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="layout-menu__panel" role="dialog" aria-label="舞台布局">
          {(Object.keys(LABELS) as StageLayout[]).map((k) => (
            <button
              key={k}
              className={`layout-menu__opt${value === k ? ' active' : ''}`}
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
