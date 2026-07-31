import { memo, useState } from 'react';

interface SiteTab { key: string; label: string; url: string; }

// 第二屏左侧内嵌的社区工具站（标签文案可随时改）
const SITES: SiteTab[] = [
  { key: 'schedule', label: '华南虎赛程分析软件', url: 'https://schedule.scutbot.cn/' },
  { key: 'ladder', label: 'RM天梯榜', url: 'https://www.micdz.cn/RM_LADDER/' },
  { key: 'fight', label: 'RM斗蛐蛐', url: 'https://rm.ecustcic.com/' },
];

// memo：零 props，杜绝被每批弹幕拖着重渲染（iframe 容器不该陪跑）
export const ReservedPanel = memo(function ReservedPanel() {
  const [active, setActive] = useState(0);
  // 已访问过的 Tab：其 iframe 一经挂载即常驻，靠 display 切换，切回不重载、各自保留滚动/状态。
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  // 已加载完成的 iframe：完成前保持面板底色（深色站里第三方页面加载期不闪白），onload 后淡入
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set());
  const open = (i: number) => {
    setActive(i);
    setVisited((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
  };
  const markLoaded = (i: number) => setLoaded((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
  const site = SITES[active];
  return (
    <div className="reserved-panel">
      <div className="rp-tabs" role="tablist">
        {SITES.map((s, i) => (
          <button
            key={s.key}
            id={`rp-tab-${s.key}`}
            className={`rp-tab${i === active ? ' active' : ''}`}
            role="tab"
            aria-selected={i === active}
            aria-controls={`rp-panel-${s.key}`}
            onClick={() => open(i)}
          >
            {s.label}
          </button>
        ))}
        <a
          className="rp-open"
          href={site.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`在新标签页打开 ${site.label}`}
        >
          <span aria-hidden="true">↗</span> 打开
        </a>
      </div>
      {/* 仅挂载访问过的站点 iframe：避免首屏并发加载三个第三方站点；挂载后常驻不重载 */}
      {SITES.map((s, i) =>
        visited.has(i) ? (
          <iframe
            key={s.key}
            id={`rp-panel-${s.key}`}
            className={`rp-frame${loaded.has(i) ? ' rp-frame--loaded' : ''}`}
            src={s.url}
            title={s.label}
            role="tabpanel"
            aria-labelledby={`rp-tab-${s.key}`}
            onLoad={() => markLoaded(i)}
            style={{ display: i === active ? 'block' : 'none' }}
          />
        ) : null,
      )}
    </div>
  );
});
