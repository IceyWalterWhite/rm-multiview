import type { Danmaku } from '../types';
import { VETERAN_POSITION, COLOR_VETERAN, COLOR_COMMON } from '../config';

type Attrs = Record<string, unknown>;

export function messageToDanmaku(id: string, text: string, attrs: Attrs): Danmaku {
  return {
    id,
    text: text ?? '',
    nickname: String(attrs.nickname ?? ''),
    schoolName: String(attrs.schoolName ?? ''),
    position: String(attrs.position ?? ''),
    racingAge: Number(attrs.racingAge) || 0,
    badge: String(attrs.badge ?? ''),
    sendTime: Number(attrs.sendTime) || 0,
    userId: Number(attrs.userId) || 0,
  };
}

// 实测规则：racingAge>0 → "{N}年{position}"，否则只显示 position
export function identityTag(d: Pick<Danmaku, 'racingAge' | 'position'>): string {
  return d.racingAge ? `${d.racingAge}年${d.position}` : d.position;
}

// 实测规则：老队员=金，其余(队员/校友)=红；与徽章无关
export function danmakuColor(d: Pick<Danmaku, 'position'>): string {
  return d.position === VETERAN_POSITION ? COLOR_VETERAN : COLOR_COMMON;
}

// 去重键：同 id 也可能因重发而内容/时间不同，故三者拼接
export function dedupeKey(d: Pick<Danmaku, 'id' | 'sendTime' | 'text'>): string {
  return `${d.id}-${d.sendTime}-${d.text}`;
}

// 从当前弹幕缓冲中挑出"需新飞"的消息：未飞过(prevSeen)且发生在 since(页面打开时刻)之后。
// 关键：nextSeen 按当前 messages 重建——而非在 prevSeen 上累加——使其上界恒为
// 缓冲长度(≤CHAT_BUFFER_LIMIT)，避免长直播中 seen 集合无限增长泄漏内存。
export function selectFreshDanmaku(
  messages: Danmaku[],
  since: number,
  prevSeen: Set<string>,
): { fresh: Danmaku[]; nextSeen: Set<string> } {
  const nextSeen = new Set<string>();
  const fresh: Danmaku[] = [];
  for (const d of messages) {
    const key = dedupeKey(d);
    nextSeen.add(key);
    if (prevSeen.has(key)) continue;     // 已处理过
    if (d.sendTime < since) continue;    // 加载回填的历史/旧弹幕：记入 seen 但不飞
    fresh.push(d);
  }
  return { fresh, nextSeen };
}

/* ===== 飞行轨道调度 =====
   同速弹幕不存在追越，唯一的重叠来源是同轨"咬尾"：上一条的尾部尚未
   全部进屏就投放下一条。因此每条轨道记录"占用到何时"（= 投放时刻 +
   自身宽度/速度 + 安全间隔），只把新弹幕投到已空闲的轨道；全忙则丢弃
   （画面早已刷满，丢弃无感；聊天列表仍完整保留）。 */

export const DM_FONT_PX = 15;      // 与 DanmakuOverlay.css 的 .dm-fly font-size 联动
const DM_EXTRA_PX = 90;            // 徽章 + 间隙 + 标签边框内边距的固定开销估算
const DM_HEADWAY_MS = 250;         // 同轨最小追加间隔（视觉呼吸空隙）

// 估算一条弹幕的渲染宽度：CJK ≈ 1em/字，西文字符更窄 → 结果偏保守（间隙只多不少）
export function estimateDanmakuWidth(
  d: Pick<Danmaku, 'text' | 'schoolName' | 'nickname' | 'racingAge' | 'position'>,
): number {
  const chars = (d.text + d.schoolName + d.nickname + identityTag(d)).length;
  return chars * DM_FONT_PX + DM_EXTRA_PX;
}

// 返回当前空闲（busyUntil ≤ now）且空闲最久的轨道下标；全忙返回 -1
export function pickFreeTrack(busyUntil: readonly number[], now: number): number {
  let best = -1;
  for (let i = 0; i < busyUntil.length; i++) {
    if (busyUntil[i] <= now && (best === -1 || busyUntil[i] < busyUntil[best])) best = i;
  }
  return best;
}

// 投放后该轨道的下一次可用时刻
export function trackBusyUntil(now: number, widthPx: number, speedPxPerS: number): number {
  return now + (widthPx / speedPxPerS) * 1000 + DM_HEADWAY_MS;
}
