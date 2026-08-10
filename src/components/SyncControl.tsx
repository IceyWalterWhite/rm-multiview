import { useEffect, useRef, useState } from 'react';
import { SyncToggle } from './SyncToggle';

interface Props {
  on: boolean;
  onToggle: () => void;
  /** 手动微调（秒，正 = 认定侧路名字钟系统性偏快） */
  trim: number;
  onTrim: (sec: number) => void;
  /** 清掉实测偏移并立刻重跑一轮音频校准；resolve 出成功重测的路数 */
  onRecalibrate?: () => Promise<number>;
}

// 「时码同步」pill：开关 + 微调披露。悬浮在主视角右上角、紧邻静音按钮，
// 与它同族材质；面板从触发器向下生长（transform-origin 锚定），
// 滑杆即改即生效（交互期间连续反馈），Esc / 点外关闭。
export function SyncControl({ on, onToggle, trim, onTrim, onRecalibrate }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [recalBusy, setRecalBusy] = useState(false);
  const [recalResult, setRecalResult] = useState<string | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (resultTimer.current !== null) clearTimeout(resultTimer.current);
  }, []);

  const runRecalibrate = async () => {
    if (recalBusy || !onRecalibrate) return;
    setRecalBusy(true);
    setRecalResult(null);
    let msg: string;
    try {
      const n = await onRecalibrate();
      // 0 路不是故障：赛间侧路是数字静音，互相关无可信峰时**拒绝**才是正确行为。
      // 说清楚「为什么没测到」，否则用户只会反复点。
      msg = n > 0 ? `已重测 ${n} 路` : '无可用音频，开赛后再试';
    } catch {
      msg = '校准失败';
    }
    setRecalBusy(false);
    setRecalResult(msg);
    if (resultTimer.current !== null) clearTimeout(resultTimer.current);
    resultTimer.current = setTimeout(() => setRecalResult(null), 5000);
  };
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
          {/* 与上面的滑杆分属两件事：滑杆是「在自动结果之上再手动挪一点」，
              这里是「把自动结果整个作废重测」。加分隔线免得「重置」被读成同一层级 */}
          {onRecalibrate && (
            <div className="sync-panel-recal">
              <button
                className="sync-recal-btn"
                onClick={runRecalibrate}
                disabled={recalBusy}
                title="丢弃已测偏移并立刻重测一轮（需比赛进行中）"
              >
                {recalBusy ? '校准中…' : '重新校准'}
              </button>
              {/* 常驻空节点而非条件插入：live region 得先在场，后填内容才会被播报 */}
              <span className="sync-recal-note" role="status" aria-live="polite">
                {recalResult ?? ''}
              </span>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
