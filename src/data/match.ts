import type { MatchTitle } from '../types';
import { CURRENT_MATCHES_URL } from '../config';

// Minimal structural types for the current_and_next_matches JSON payload.
interface MatchZone { name?: string; event?: { title?: string } }
interface MatchSide { player?: { team?: { collegeName?: string; name?: string } } | null }
export interface MatchEntry {
  orderNumber?: number;
  zone?: MatchZone;
  redSide?: MatchSide;
  blueSide?: MatchSide;
}
interface ZoneEntry {
  currentMatch?: MatchEntry | null;
  nextMatch?: MatchEntry | null;
}

// 剥掉赛事名前导的非中文（"RMUC 2026超级对抗赛" → "超级对抗赛"）；剥成空则回退原值
export function shortenEventName(title: string): string {
  const s = (title ?? '').replace(/^[^一-鿿]+/, '').trim();
  return s || (title ?? '').trim();
}

function college(side: MatchSide | undefined): string {
  return String(side?.player?.team?.collegeName ?? '');
}
function team(side: MatchSide | undefined): string {
  return String(side?.player?.team?.name ?? '');
}

// 照搬官方 pages/live/index 拼接：事件名 赛区 第N场 红校 红队 vs 蓝校 蓝队；缺一方则省略 vs
export function formatMatchTitle(match: MatchEntry): string {
  const event = shortenEventName(String(match?.zone?.event?.title ?? ''));
  const zone = String(match?.zone?.name ?? '');
  const order = match?.orderNumber ? `第${match.orderNumber}场` : '';
  const red = [college(match?.redSide), team(match?.redSide)].filter(Boolean).join(' ');
  const blue = [college(match?.blueSide), team(match?.blueSide)].filter(Boolean).join(' ');
  const head = [event, zone, order].filter(Boolean).join(' ');
  if (red && blue) return [head, `${red} vs ${blue}`].filter(Boolean).join(' ');
  return [head, red, blue].filter(Boolean).join(' ');
}

// current_and_next_matches.json 是数组，每元素对应一个赛区。
// 按 zone.name === zoneName 定位该赛区元素，优先 currentMatch，无则退回 nextMatch，再无返回 null。
export function parseCurrentMatch(json: unknown, zoneName: string): MatchTitle | null {
  const arr: ZoneEntry[] = Array.isArray(json) ? json : [];
  const el = arr.find((e) => {
    const z = e?.currentMatch?.zone?.name ?? e?.nextMatch?.zone?.name;
    return z === zoneName;
  });
  if (!el) return null;
  const m = el.currentMatch ?? el.nextMatch;
  return m ? { text: formatMatchTitle(m), isNext: !el.currentMatch } : null;}

export async function fetchMatchTitle(
  zoneName: string,
  url: string = CURRENT_MATCHES_URL,
): Promise<MatchTitle | null> {
  const res = await fetch(url, { cache: 'no-store' }); // 实时拉取，与 live_game_info 一致
  if (!res.ok) throw new Error(`current_and_next_matches fetch failed: ${res.status}`);
  return parseCurrentMatch(await res.json(), zoneName);
}
