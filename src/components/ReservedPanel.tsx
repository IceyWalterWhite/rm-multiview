import { useState } from 'react';

interface SiteTab { key: string; label: string; url: string; }

// 第二屏左侧内嵌的社区工具站（标签文案可随时改）
const SITES: SiteTab[] = [
  { key: 'schedule', label: '华南虎赛程分析软件', url: 'https://schedule.scutbot.cn/' },
  { key: 'ladder', label: 'RM天梯榜', url: 'https://www.micdz.cn/RM_LADDER/' },
];

export function ReservedPanel() {
  const [active, setActive] = useState(0);
  const site = SITES[active];
  return (
    <div className="reserved-panel">
      <div className="rp-tabs">
        {SITES.map((s, i) => (
          <button
            key={s.key}
            className={`rp-tab${i === active ? ' active' : ''}`}
            onClick={() => setActive(i)}
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
      {/* 两个 iframe 都常驻，靠 display 切换：切 Tab 不重载、各自保留滚动/状态 */}
      {SITES.map((s, i) => (
        <iframe
          key={s.key}
          className="rp-frame"
          src={s.url}
          title={s.label}
          style={{ display: i === active ? 'block' : 'none' }}
        />
      ))}
    </div>
  );
}
