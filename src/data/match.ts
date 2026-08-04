import type { CheerTarget, MatchTitle } from '../types';
import { CURRENT_MATCHES_URL } from '../config';

// Minimal structural types for the current_and_next_matches JSON payload.
interface MatchZone { name?: string; event?: { title?: string } }
interface MatchSide { player?: { team?: { id?: unknown; collegeName?: string; name?: string } } | null }
export interface MatchEntry {
  id?: unknown;
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
function sideLabel(side: MatchSide | undefined): string {
  return [college(side), team(side)].filter(Boolean).join(' ');
}
function teamId(side: MatchSide | undefined): string {
  const id = side?.player?.team?.id;
  return id === undefined || id === null ? '' : String(id);
}

// 照搬官方 pages/live/index 拼接：事件名 赛区 第N场 红校 红队 vs 蓝校 蓝队；缺一方则省略 vs
export function formatMatchTitle(match: MatchEntry): string {
  const event = shortenEventName(String(match?.zone?.event?.title ?? ''));
  const zone = String(match?.zone?.name ?? '');
  const order = match?.orderNumber ? `第${match.orderNumber}场` : '';
  const red = sideLabel(match?.redSide);
  const blue = sideLabel(match?.blueSide);
  const head = [event, zone, order].filter(Boolean).join(' ');
  if (red && blue) return [head, `${red} vs ${blue}`].filter(Boolean).join(' ');
  return [head, red, blue].filter(Boolean).join(' ');
}

// current_and_next_matches.json 是数组，每元素对应一个赛区。
// 按 zone.name === zoneName 定位该赛区元素，优先 currentMatch，无则退回 nextMatch，再无返回 null。
function findZoneEntry(json: unknown, zoneName: string): ZoneEntry | undefined {
  const arr: ZoneEntry[] = Array.isArray(json) ? json : [];
  return arr.find((e) => {
    const z = e?.currentMatch?.zone?.name ?? e?.nextMatch?.zone?.name;
    return z === zoneName;
  });
}

export function parseCurrentMatch(json: unknown, zoneName: string): MatchTitle | null {
  const el = findZoneEntry(json, zoneName);
  if (!el) return null;
  const m = el.currentMatch ?? el.nextMatch;
  return m ? { text: formatMatchTitle(m), isNext: !el.currentMatch } : null;}

export function parseCheerTarget(json: unknown, zoneName: string): CheerTarget | null {
  const match = findZoneEntry(json, zoneName)?.currentMatch;
  if (!match) return null;
  const matchId = match.id === undefined || match.id === null ? '' : String(match.id);
  const redTeamId = teamId(match.redSide);
  const blueTeamId = teamId(match.blueSide);
  if (!matchId || !redTeamId || !blueTeamId) return null;
  return {
    matchId,
    redTeamId,
    blueTeamId,
    redLabel: sideLabel(match.redSide),
    blueLabel: sideLabel(match.blueSide),
  };
}

export async function fetchMatchTitle(
  zoneName: string,
  url: string = CURRENT_MATCHES_URL,
): Promise<MatchTitle | null> {
  const res = await fetch(url, { cache: 'no-store' }); // 实时拉取，与 live_game_info 一致
  if (!res.ok) throw new Error(`current_and_next_matches fetch failed: ${res.status}`);
  return parseCurrentMatch(await res.json(), zoneName);
}

export async function fetchCheerTarget(
  zoneName: string,
  url: string = CURRENT_MATCHES_URL,
): Promise<CheerTarget | null> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`current_and_next_matches fetch failed: ${res.status}`);
  return parseCheerTarget(await res.json(), zoneName);
}
