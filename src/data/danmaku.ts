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
