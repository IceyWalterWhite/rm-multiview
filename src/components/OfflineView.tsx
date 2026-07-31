import type { MouseEvent } from 'react';
import { ReservedPanel } from './ReservedPanel';
import { IcpFooter } from './IcpFooter';
import { prefersReducedMotion } from '../a11y';

// 无直播时的两屏布局：第一屏盖「当前没有直播」遮罩（占满首屏），
// 第二屏照常显示内嵌社区工具站，可向下滚动查看（赛程 / 天梯榜 / 斗蛐蛐）。
// 聊天室依赖直播赛区连接，无直播时省略，留 ReservedPanel 占满整屏。
export function OfflineView() {
  const scrollToCommunity = (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById('community')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };
  return (
    <div className="app">
      <section className="live-stage offline-stage">
        <div>
          <div className="offline-title">⚠ 当前没有直播</div>
          <a className="offline-hint" href="#community" onClick={scrollToCommunity}>下滑查看赛程 · 天梯榜 · 社区工具 ↓</a>
        </div>
      </section>
      <section className="chat-section" id="community">
        <ReservedPanel />
        <IcpFooter />
      </section>
    </div>
  );
}
