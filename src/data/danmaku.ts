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
