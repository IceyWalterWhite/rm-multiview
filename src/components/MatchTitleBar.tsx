import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const SPEED_PX_PER_S = 25; // 照搬官方滚动速度

interface Props {
  text?: string | null;
  isNext?: boolean;
  fallback: string; // 无赛事数据时的兜底文案
}

export function MatchTitleBar({ text, isNext, fallback }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const display = text ? (isNext ? '下一场 ' : '') + text : fallback;

  // 只有溢出时才滚动：测量容器与文本宽度差
  const [overflowing, setOverflowing] = useState(false);
  const [durationMs, setDurationMs] = useState(0);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!container || !el) return;

    const cs = getComputedStyle(container);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const innerW = container.clientWidth - padX;
    const overflow = el.scrollWidth - innerW;

    if (overflow <= 0) {
      setOverflowing(false);
      setDurationMs(0);
    } else {
      setOverflowing(true);
      // 两份文本拼接后总宽度 = 2 × scrollWidth，动画从 0 → -scrollWidth
      // 等效距离 = scrollWidth（一份完整文本）
      setDurationMs((el.scrollWidth / SPEED_PX_PER_S) * 1000);
    }
  }, []);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [display, measure]);

  return (
    <div className="match-title" ref={containerRef}>
      {overflowing ? (
        <span
          className="match-title__scroll"
          style={{ animationDuration: `${durationMs}ms` }}
        >
          {/* 两份文本拼接：translateX 从 0 到 -50% 实现无缝循环 */}
          <span ref={textRef} className="match-title__seg">{display}</span>
          <span className="match-title__seg">{display}</span>
        </span>
      ) : (
        <span className="match-title__text" ref={textRef}>{display}</span>
      )}
    </div>
  );
}
