import { useEffect, useRef, useState } from 'react';
import { SyncToggle } from './SyncToggle';

interface Props {
  on: boolean;
  onToggle: () => void;
  /** 手动微调（秒，正 = 认定侧路名字钟系统性偏快） */
  trim: number;
  onTrim: (sec: number) => void;
}

// 「时码同步」pill：开关 + 微调披露。悬浮在主视角右上角、紧邻静音按钮，
// 与它同族材质；面板从触发器向下生长（transform-origin 锚定），
// 滑杆即改即生效（交互期间连续反馈），Esc / 点外关闭。
export function SyncControl({ on, onToggle, trim, onTrim }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  // 同步关掉时面板一并收起。渲染期推导而非 effect+setState——
  // 后者要多跑一轮渲染才收起，且 open 残留为 true，重新开启同步时面板会自己弹出来
  const panelOpen = open && on;

  // 关闭路径：Esc（stopPropagation 避免顺带收起放大的机位）与点外
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    // capture：抢在放大机位的 Esc 处理器之前
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [panelOpen]);

  return (
    <span className="sync-pill" ref={rootRef}>
      <SyncToggle on={on} onToggle={onToggle} />
      {on && (
        // 画面上寸土寸金：只留箭头，可访问名由 aria-label 承担（观赛屏不铺控件带）
        <button
          className={`sync-trim-btn${panelOpen ? ' active' : ''}`}
          aria-expanded={panelOpen}
          aria-label="同步微调"
          onClick={() => setOpen((v) => !v)}
          title="同步微调"
        >
          <span aria-hidden="true">{panelOpen ? '▴' : '▾'}</span>
        </button>
      )}
      {panelOpen && (
        <div className="sync-panel">
          <div className="sync-panel-row">
            <label htmlFor="sync-trim">同步微调</label>
            <output htmlFor="sync-trim" className="sync-trim-value">
              {trim >= 0 ? '+' : '−'}
              {Math.abs(trim).toFixed(1)}s
            </output>
          </div>
          <input
            id="sync-trim"
            type="range"
            min={-5}
            max={5}
            step={0.1}
            value={trim}
            aria-label="同步微调（秒）"
            onChange={(e) => onTrim(Number(e.target.value))}
          />
          <div className="sync-panel-row">
            <span className="sync-panel-hint">侧视角整体提前/延后</span>
            <button className="sync-trim-reset" onClick={() => onTrim(0)}>
              重置
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
