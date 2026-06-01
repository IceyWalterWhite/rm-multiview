import { useEffect, useRef, useState } from 'react';
import type { Danmaku } from '../types';
import { identityTag, danmakuColor } from '../data/danmaku';
import { ANNIVERSARY_BADGE } from '../config';
import './DanmakuOverlay.css';

const TRACKS = 5;
const DURATION_MS = 9000;

interface Flying { key: string; d: Danmaku; track: number; }

export function DanmakuOverlay({ messages }: { messages: Danmaku[] }) {
  const [flying, setFlying] = useState<Flying[]>([]);
  const lastId = useRef<string | null>(null);
  const trackRR = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mountAt = useRef(Date.now()); // 页面打开时刻：只飞此后到达的新弹幕

  useEffect(() => {
    const latest = messages.at(-1);
    if (!latest || latest.id === lastId.current) return;
    lastId.current = latest.id;
    // 加载时回填的历史/旧弹幕(sendTime 久远)不在主视角飞，只飞页面打开后的新消息
    if (latest.sendTime < mountAt.current) return;
    const track = trackRR.current % TRACKS;
    trackRR.current += 1;
    const key = `${latest.id}-${trackRR.current}`;
    setFlying((f) => [...f, { key, d: latest, track }]);
    const t = setTimeout(() => {
      setFlying((f) => f.filter((x) => x.key !== key));
      timers.current = timers.current.filter((x) => x !== t);
    }, DURATION_MS);
    timers.current.push(t);
  }, [messages]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []); // clear all on unmount only

  return (
    <div className="dm-overlay">
      {flying.map(({ key, d, track }) => (
        <div key={key} className="dm-fly" style={{ top: `${8 + track * 16}%`, animationDuration: `${DURATION_MS}ms` }}>
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
