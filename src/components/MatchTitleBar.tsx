import { useLayoutEffect, useRef } from 'react';

const SPEED_PX_PER_S = 25; // 照搬官方滚动速度
const PAUSE_MS = 1500;     // 滑到底 / 归零后的停顿

interface Props {
  text?: string | null;
  isNext?: boolean;
  fallback: string; // 无赛事数据时的兜底文案，如 "北部赛区 · 主视角"
}

// 照搬官方 handleTextScroll：测溢出量，仅溢出才滚；滑到底→停→瞬时归零→循环。
export function MatchTitleBar({ text, isNext, fallback }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const display = text ? (isNext ? '下一场 ' : '') + text : fallback;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!container || !el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

    const reset = () => {
      el.style.transitionDuration = '0s';
      el.style.transform = 'translateX(0)';
    };

    const run = () => {
      if (cancelled) return;
      reset();
      const overflow = el.scrollWidth - container.clientWidth;
      if (overflow <= 0) return; // 不溢出不滚
      const durMs = (overflow / SPEED_PX_PER_S) * 1000;
      timer = setTimeout(() => {
        if (cancelled) return;
        el.style.transitionDuration = `${durMs}ms`;
        el.style.transform = `translateX(-${overflow}px)`; // 滑到露出末尾
        timer = setTimeout(() => {
          if (cancelled) return;
          reset();                              // 瞬时弹回开头
          timer = setTimeout(run, PAUSE_MS);    // 停顿后再循环
        }, durMs + PAUSE_MS);
      }, PAUSE_MS);
    };

    const restart = () => { clear(); run(); };
    run();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(restart) : null;
    ro?.observe(container);

    return () => {
      cancelled = true;
      clear();
      ro?.disconnect();
      reset(); // 等价官方 clearScrollState
    };
  }, [display]);

  return (
    <div className="match-title" ref={containerRef}>
      <span className="match-title__text" ref={textRef}>{display}</span>
    </div>
  );
}
