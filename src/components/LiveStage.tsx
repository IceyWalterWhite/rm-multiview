import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Danmaku, Profile, ZoneCatalog } from '../types';
import type { QualityLabel } from '../config';
import { SideColumn } from './SideColumn';
import { MainStage } from './MainStage';
import { QualityControls } from './QualityControls';
import { DanmakuComposer } from './DanmakuComposer';
import { useMatchTitle } from '../hooks/useMatchTitle';
import { useEnlarged } from '../hooks/useEnlarged';
import { prefersReducedMotion } from '../a11y';

interface Props {
  catalog: ZoneCatalog;
  messages: Danmaku[];
  danmakuEnabled: boolean;
  cheerSlot?: ReactNode;
  watchTaskSlot?: ReactNode;
  mainQuality: QualityLabel;
  multiQuality: QualityLabel;
  setMainQuality: (q: QualityLabel) => void;
  setMultiQuality: (q: QualityLabel) => void;
  profile: Profile;
  isComplete: boolean;
  onSend: (text: string) => Promise<void> | void;
  onEditIdentity: () => void;
  onSignatureExpired?: () => void;
  onMainPlayingChange?: (playing: boolean) => void;
}

export function LiveStage(p: Props) {
  const [tooNarrow, setTooNarrow] = useState(false);
  const [danmakuOn, setDanmakuOn] = useState(true);
  const rowRef = useRef<HTMLDivElement>(null);
  // 多路放大：互不遮挡的机位可以同时开着，会被挤到的那一路自动缩回去。
  // toggle/clear 引用稳定，才不会击穿 SideColumn 的 memo（弹幕批次不该重渲染 11 路机位）
  const { stacks, toggle, clear } = useEnlarged(rowRef);
  const matchTitle = useMatchTitle(p.catalog.zoneName);

  // Esc 收起全部放大的机位（wayfinding：任何状态都要有键盘退路）。
  // 对话框开着时 Esc 属于对话框（原生 cancel），不越权抢收
  const hasEnlarged = stacks.size > 0;
  useEffect(() => {
    if (!hasEnlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasEnlarged, clear]); // 依赖布尔而非 stacks 本身：多路开关不必反复重绑监听

  // 主视角宽度 < 侧列宽度（窗口太窄到看不清）→ 盖「请在大屏幕上观看」遮罩
  // 同时从 CSS 读取 .side-column 的真实 gap，动态设 --side-col-w 使 5 个 16:9 机位精确填满行高
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const check = () => {
      const side = row.querySelector<HTMLElement>('.side-column');
      const main = row.querySelector<HTMLElement>('.main-stage');
      // 从 CSS computed style 读取真实 gap，CSS 是唯一真相源
      const rawGap = side ? parseFloat(getComputedStyle(side).rowGap) : NaN;
      const gapPx = Number.isFinite(rawGap) ? rawGap : 6;
      const totalGap = gapPx * 4; // 5 个机位之间有 4 条 gap
      // colW * 9/16 * 5 + totalGap = rowH  →  colW = (rowH - totalGap) * 16/45
      const colW = (row.clientHeight - totalGap) * 16 / 45;
      row.style.setProperty('--side-col-w', String(Math.max(0, colW)) + 'px');
      if (side && main) setTooNarrow(main.clientWidth < side.clientWidth);
    };
    const ro = new ResizeObserver(check);
    ro.observe(row);
    check();
    return () => ro.disconnect();
  }, []);

  const scrollToCommunity = (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById('community')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <section className="live-stage" aria-label="直播视角">
      <div className="stage-row" ref={rowRef}>
        <SideColumn side="red" views={p.catalog.redViews} quality={p.multiQuality} stacks={stacks} onToggle={toggle} onSignatureExpired={p.onSignatureExpired} />
        <MainStage main={p.catalog.main} quality={p.mainQuality} titleFallback={`${p.catalog.zoneName} · 主视角`} matchTitle={matchTitle} messages={p.messages} showDanmaku={danmakuOn} cheerSlot={p.cheerSlot} onSignatureExpired={p.onSignatureExpired} onPlayingChange={p.onMainPlayingChange} />
        <SideColumn side="blue" views={p.catalog.blueViews} quality={p.multiQuality} stacks={stacks} onToggle={toggle} onSignatureExpired={p.onSignatureExpired} />
        {tooNarrow && <div className="stage-cover">请在大屏幕上观看</div>}
      </div>
      <div className="controls">
        <QualityControls mainQuality={p.mainQuality} multiQuality={p.multiQuality} onMain={p.setMainQuality} onMulti={p.setMultiQuality} />
        {p.watchTaskSlot}
        {/* B 站式：弹幕开关放输入条内（同一个框），避免两个不等高的框并排 */}
        {p.danmakuEnabled && (
          <DanmakuComposer
            profile={p.profile}
            isComplete={p.isComplete}
            onSend={p.onSend}
            onEditIdentity={p.onEditIdentity}
            leading={<button className={`dm-toggle${danmakuOn ? ' active' : ''}`} onClick={() => setDanmakuOn((v) => !v)} aria-pressed={danmakuOn} title={danmakuOn ? '关闭弹幕' : '开启弹幕'}>弹幕</button>}
          />
        )}
        {/* 第二屏路标：没有它，恰好占满一屏的首屏看不出下面还有内容 */}
        <a className="scroll-hint" href="#community" onClick={scrollToCommunity}>下滑查看社区工具👇</a>
      </div>
    </section>
  );
}
