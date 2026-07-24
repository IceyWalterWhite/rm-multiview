import { ReservedPanel } from './ReservedPanel';
import { IcpFooter } from './IcpFooter';

// 无直播时的两屏布局：第一屏盖「当前没有直播」遮罩（占满首屏），
// 第二屏照常显示内嵌社区工具站，可向下滚动查看（赛程 / 天梯榜 / 斗蛐蛐）。
// 聊天室依赖直播赛区连接，无直播时省略，留 ReservedPanel 占满整屏。
export function OfflineView() {
  return (
    <div className="app">
      <section className="live-stage offline-stage">
        <div className="offline-title">⚠ 当前没有直播</div>
      </section>
      <section className="chat-section">
        <ReservedPanel />
        <IcpFooter />
      </section>
    </div>
  );
}
