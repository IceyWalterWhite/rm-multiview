import { useEffect, useRef, useState } from 'react';
import type { Danmaku } from '../types';
import {
  identityTag, danmakuColor, selectFreshDanmaku, dedupeKey,
  estimateDanmakuWidth, pickFreeTrack, trackBusyUntil,
} from '../data/danmaku';
import { ANNIVERSARY_BADGE } from '../config';
import './DanmakuOverlay.css';

const TRACKS = 5;
const SPEED_PX_PER_S = 160; // 弹幕水平速度（像素/秒）：恒定，与屏幕宽度无关
const TRACK_TOP_PCT = 8;    // 第 0 条轨道距顶 8%
const TRACK_GAP_PCT = 5;    // 轨道间距 5% → 5 条落在 8%~28%，更密集
// 高峰限流：每条飞行弹幕都是一个合成层，与 11 路视频解码抢资源；
// 轨道全忙或达上限时丢弃新弹幕（画面早已刷满，丢弃无感；聊天列表仍完整保留）。
const MAX_CONCURRENT = 80;

// 飞行距离固定为 140vw（见 keyframe dm-move）= 1.4×视口宽 px：100vw 出屏 + 40vw
// 容纳自身宽度的余量。时长 = 距离 / 速度，任意屏宽下都是同一 px/s（宽屏不再变快）。
function flyDurationMs(): number {
  return (window.innerWidth * 1.4) / SPEED_PX_PER_S * 1000;
}

interface Flying { key: string; d: Danmaku; track: number; durationMs: number; }

export function DanmakuOverlay({ messages }: { messages: Danmaku[] }) {
  const [flying, setFlying] = useState<Flying[]>([]);
  const seen = useRef(new Set<string>());
  const seq = useRef(0); // key 唯一性计数（同 dedupeKey 消息重飞时区分）
  const busyUntil = useRef<number[]>(Array<number>(TRACKS).fill(0));
  const mountAt = useRef<number | null>(null); // 页面打开时刻：只飞此后到达的新弹幕

  useEffect(() => {
    mountAt.current = Date.now();
  }, []);

  useEffect(() => {
    if (mountAt.current === null) return;
    // 只飞页面打开后的新消息；seen 随缓冲重建，长直播下不会无限增长。
    const { fresh, nextSeen } = selectFreshDanmaku(messages, mountAt.current, seen.current);
    seen.current = nextSeen;
    if (!fresh.length) return;
    // 轨道调度：只投空闲轨道，杜绝同轨咬尾重叠（爆发时超出轨道数的部分丢弃）
    const now = Date.now();
    const nextFlying: Flying[] = [];
    for (const d of fresh) {
      const track = pickFreeTrack(busyUntil.current, now);
      if (track === -1) continue;
      busyUntil.current[track] = trackBusyUntil(now, estimateDanmakuWidth(d), SPEED_PX_PER_S);
      seq.current += 1;
      nextFlying.push({ key: `${dedupeKey(d)}-${seq.current}`, d, track, durationMs: flyDurationMs() });
    }
    if (!nextFlying.length) return;
    // 有意为之：飞行队列是外部事件驱动的状态机，轨道占用/去重/序号都是随时间演进的 ref 状态，
    // 渲染期既算不出也不能改（StrictMode 双调用会重复占轨道）。多出的那一轮渲染在同一帧内完成，
    // 视觉无差别。要真正消除需把调度移出 React 用 useSyncExternalStore 订阅——独立重构。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlying((f) => {
      const room = MAX_CONCURRENT - f.length;
      if (room <= 0) return f;
      return room >= nextFlying.length ? [...f, ...nextFlying] : [...f, ...nextFlying.slice(0, room)];
    });
  }, [messages]);

  // 飞完（动画结束）即移除。hover 暂停时动画不结束，故不会半途消失。
  const handleEnd = (key: string) => setFlying((f) => f.filter((x) => x.key !== key));

  return (
    // 与聊天列表内容重复，读屏不该念两遍
    <div className="dm-overlay" aria-hidden="true">
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
