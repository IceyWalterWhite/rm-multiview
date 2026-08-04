import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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

function createFlyingStore() {
  let value: Flying[] = [];
  const listeners = new Set<() => void>();
  const publish = (next: Flying[]) => {
    if (next === value) return;
    value = next;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => value,
    append: (items: Flying[]) => {
      const room = MAX_CONCURRENT - value.length;
      if (room <= 0) return;
      publish([...value, ...items.slice(0, room)]);
    },
    remove: (key: string) => publish(value.filter((item) => item.key !== key)),
    clear: () => publish([]),
  };
}

export function DanmakuOverlay({ messages }: { messages: Danmaku[] }) {
  const [store] = useState(createFlyingStore);
  const flying = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const seen = useRef(new Set<string>());
  const seq = useRef(0); // key 唯一性计数（同 dedupeKey 消息重飞时区分）
  const busyUntil = useRef<number[]>(Array<number>(TRACKS).fill(0));
  const mountAt = useRef<number | null>(null); // 页面打开时刻：只飞此后到达的新弹幕

  useEffect(() => {
    mountAt.current = Date.now();
  }, []);

  // 回到前台：清空积压并释放轨道，从干净状态重新开始。
  // 离开期间冻在半空的弹幕是过期内容（用户根本没看见），继续放完只会和新弹幕挤在一起。
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      store.clear();
      busyUntil.current.fill(0);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [store]);

  useEffect(() => {
    if (mountAt.current === null) return;
    // 只飞页面打开后的新消息；seen 随缓冲重建，长直播下不会无限增长。
    const { fresh, nextSeen } = selectFreshDanmaku(messages, mountAt.current, seen.current);
    seen.current = nextSeen;
    // 后台标签页不投放：那里 CSS 动画不推进、animationend 不触发，投进去的只进不出，
    // 而 busyUntil 按真实时间流逝照常释放轨道，于是一路堆到 MAX_CONCURRENT，
    // 回到前台 80 条同时起飞——这就是「切后台再回来会爆发」的成因。
    // 注意 seen 在上面已经照常更新：离开期间的弹幕不补放，聊天列表里仍然完整。
    if (typeof document !== 'undefined' && document.hidden) return;
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
    store.append(nextFlying);
  }, [messages, store]);

  // 飞完（动画结束）即移除。hover 暂停时动画不结束，故不会半途消失。
  const handleEnd = (key: string) => store.remove(key);

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
