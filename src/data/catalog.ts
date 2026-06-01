import type { ZoneCatalog, StreamView, QualitySource, Side } from '../types';
import { DISCARD_ROLE_KEYWORDS, LIVE_GAME_INFO_URL } from '../config';

function streamId(src: string): string {
  const m = /\/robomaster\/([^/?.]+)/.exec(src ?? '');
  return m ? m[1] : '';
}
function toSources(raw: any[]): QualitySource[] {
  return (raw ?? []).map((s) => ({ label: String(s.label), src: String(s.src), res: String(s.res ?? '') }));
}
function sideOf(role: string): Side {
  if (role.includes('红')) return 'red';
  if (role.includes('蓝')) return 'blue';
  return 'main';
}
function isDiscarded(role: string): boolean {
  return DISCARD_ROLE_KEYWORDS.some((k) => role.includes(k));
}

// 没有 liveState===1 的赛区：赛事未开始或已结束。与网络/解析失败区分开，
// 便于上层在签名重取时把「直播已结束」识别为终态，而非可重试的瞬时错误。
export class NoLiveZoneError extends Error {
  constructor() {
    super('no live zone (liveState===1) found');
    this.name = 'NoLiveZoneError';
  }
}

export function parseLiveGameInfo(json: any): ZoneCatalog {
  const zones: any[] = json?.eventData ?? [];
  const zone = zones.find((z) => z?.liveState === 1);
  if (!zone) throw new NoLiveZoneError();

  const mainSources = toSources(zone.zoneLiveString);
  const main: StreamView = {
    id: streamId(mainSources[0]?.src ?? ''),
    role: '主视角',
    side: 'main',
    sources: mainSources,
  };

  const redViews: StreamView[] = [];
  const blueViews: StreamView[] = [];
  for (const f of zone.fpvData ?? []) {
    const role = String(f.role ?? '');
    if (isDiscarded(role)) continue;
    const sources = toSources(f.sources);
    const view: StreamView = { id: streamId(sources[0]?.src ?? ''), role, side: sideOf(role), sources };
    if (view.side === 'red') redViews.push(view);
    else if (view.side === 'blue') blueViews.push(view);
  }

  return { zoneName: String(zone.zoneName ?? ''), chatRoomId: String(zone.chatRoomId ?? ''), main, redViews, blueViews };
}

export async function fetchCatalog(url: string = LIVE_GAME_INFO_URL): Promise<ZoneCatalog> {
  const res = await fetch(url, { cache: 'no-store' }); // 每次进入实时获取 → 新鲜签名
  if (!res.ok) throw new Error(`live_game_info fetch failed: ${res.status}`);
  return parseLiveGameInfo(await res.json());
}
