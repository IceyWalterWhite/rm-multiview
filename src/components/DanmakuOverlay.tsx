import { useEffect, useRef, useState } from 'react';
import type { Danmaku } from '../types';
import { identityTag, danmakuColor } from '../data/danmaku';
import { ANNIVERSARY_BADGE } from '../config';
import './DanmakuOverlay.css';

const TRACKS = 5;
const SPEED_PX_PER_S = 160; // 弹幕水平速度（像素/秒）：恒定，与屏幕宽度无关
const TRACK_TOP_PCT = 8;    // 第 0 条轨道距顶 8%
const TRACK_GAP_PCT = 5;    // 轨道间距 5% → 5 条落在 8%~28%，更密集

// 飞行距离固定为 220vw（见 keyframe dm-move）= 2.2×视口宽 px；
// 时长 = 距离 / 速度，于是任意屏宽下都是同一 px/s（宽屏不再变快）。
function flyDurationMs(): number {
  return (window.innerWidth * 2.2) / SPEED_PX_PER_S * 1000;
}

interface Flying { key: string; d: Danmaku; track: number; durationMs: number; }

export function DanmakuOverlay({ messages }: { messages: Danmaku[] }) {
  const [flying, setFlying] = useState<Flying[]>([]);
  const seen = useRef(new Set<string>());
  const trackRR = useRef(0);
  const mountAt = useRef<number | null>(null); // 页面打开时刻：只飞此后到达的新弹幕

  useEffect(() => {
    mountAt.current = Date.now();
  }, []);

  useEffect(() => {
    if (mountAt.current === null) return;
    const nextFlying: Flying[] = [];
    for (const d of messages) {
      const messageKey = `${d.id}-${d.sendTime}-${d.text}`;
      if (seen.current.has(messageKey)) continue;
      seen.current.add(messageKey);
      // 加载时回填的历史/旧弹幕(sendTime 久远)不在主视角飞，只飞页面打开后的新消息
      if (d.sendTime < mountAt.current) continue;
      const track = trackRR.current % TRACKS;
      trackRR.current += 1;
      nextFlying.push({ key: `${messageKey}-${trackRR.current}`, d, track, durationMs: flyDurationMs() });
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- incoming messages append to the animation queue, then animationend removes them.
    if (nextFlying.length) setFlying((f) => [...f, ...nextFlying]);
  }, [messages]);

  // 飞完（动画结束）即移除。hover 暂停时动画不结束，故不会半途消失。
  const handleEnd = (key: string) => setFlying((f) => f.filter((x) => x.key !== key));

  return (
    <div className="dm-overlay">
      {flying.map(({ key, d, track, durationMs }) => (
        <div
          key={key}
          className="dm-fly"
          style={{ top: `${TRACK_TOP_PCT + track * TRACK_GAP_PCT}%`, animationDuration: `${durationMs}ms` }}
          onAnimationEnd={() => handleEnd(key)}
        >
          {d.badge === ANNIVERSARY_BADGE && <i className="dm-badge" />}
          <span className="dm-tag" style={{ color: danmakuColor(d) }}>{identityTag(d)}</span>
          <span className="dm-school">{d.schoolName}</span>
          <span className="dm-nick" style={{ color: danmakuColor(d) }}>{d.nickname}</span>
          <span className="dm-text">{d.text}</span>
        </div>
      ))}
    </div>
  );
}
