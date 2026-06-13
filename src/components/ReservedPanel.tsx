import { useState } from 'react';

interface SiteTab { key: string; label: string; url: string; }

// 第二屏左侧内嵌的社区工具站（标签文案可随时改）
const SITES: SiteTab[] = [
  { key: 'schedule', label: '华南虎赛程分析软件', url: 'https://schedule.scutbot.cn/' },
  { key: 'ladder', label: 'RM天梯榜', url: 'https://www.micdz.cn/RM_LADDER/' },
  { key: 'fight', label: 'RM斗蛐蛐', url: 'https://rm.ecustcic.com/' },
];

export function ReservedPanel() {
  const [active, setActive] = useState(0);
  // 已访问过的 Tab：其 iframe 一经挂载即常驻，靠 display 切换，切回不重载、各自保留滚动/状态。
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const open = (i: number) => {
    setActive(i);
    setVisited((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
  };
  const site = SITES[active];
  return (
    <div className="reserved-panel">
      <div className="rp-tabs">
        {SITES.map((s, i) => (
          <button
            key={s.key}
            className={`rp-tab${i === active ? ' active' : ''}`}
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
          ↗ 打开
        </a>
      </div>
      {/* 仅挂载访问过的站点 iframe：避免首屏并发加载三个第三方站点；挂载后常驻不重载 */}
      {SITES.map((s, i) =>
        visited.has(i) ? (
          <iframe
            key={s.key}
            className="rp-frame"
            src={s.url}
            title={s.label}
            style={{ display: i === active ? 'block' : 'none' }}
          />
        ) : null,
      )}
    </div>
  );
}
