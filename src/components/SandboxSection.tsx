import { Suspense, lazy, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ZoneCatalog } from '../types';
import { prefersReducedMotion } from '../a11y';

/**
 * 沙盘屏：介于观赛屏与社区屏之间的第二屏。
 *
 * 单开一屏而不是塞进社区屏，是因为地图要面积 —— 社区屏已经是「工具站 + 聊天室」
 * 两栏，再塞一栏三样都看不清。
 *
 * **整个沙盘（含识别代码）是一个懒加载边界。** 滚到这一屏之前，
 * 检测、three.js、场地模型一个字节都不下 —— 首屏包必须保持在只装观赛所需的量级。
 */
const SandboxMap = lazy(() =>
  import('./SandboxMap').then((m) => ({ default: m.SandboxMap })),
);

interface Props {
  catalog: ZoneCatalog;
}

export function SandboxSection({ catalog }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);

  // 提前一屏开始加载：等用户滚到了再下 7.6 MiB 就太晚了，
  // 但也不能一进站就下 —— rootMargin 一屏正好是「快到了」的意思
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '100% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toCommunity = (e: MouseEvent) => {
    e.preventDefault();
    document
      .getElementById('community')
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <section className="sandbox-section" id="sandbox" aria-label="实时沙盘" ref={ref}>
      {near ? (
        <Suspense fallback={<div className="sandbox"><div className="sandbox-cover">沙盘加载中…</div></div>}>
          <SandboxMap catalog={catalog} />
        </Suspense>
      ) : (
        <div className="sandbox" />
      )}
      <a className="scroll-hint" href="#community" onClick={toCommunity}>
        下滑查看聊天室 · 社区工具👇
      </a>
    </section>
  );
}
