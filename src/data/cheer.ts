import type { CheerInfo, CheerTarget } from '../types';
import { CHEER_PROXY_PATH } from '../config';
import { toNum } from './saas';

interface CheerInfoPayload {
  redVotes?: unknown;
  blueVotes?: unknown;
  voteEnabled?: unknown;
}

export function normalizeCheerInfo(data: unknown): CheerInfo {
  const d = (data ?? {}) as CheerInfoPayload;
  return {
    redVotes: toNum(d.redVotes),
    blueVotes: toNum(d.blueVotes),
    voteEnabled: d.voteEnabled === true,
  };
}

/**
 * 代理请求失败。带上状态码是为了让上层区分两种失败：
 * 404 = 代理函数根本不在（本地 vite dev / 未部署），重试无意义，应当直接关掉助威；
 * 其余 = 上游或网络的瞬时问题，保留上次好值继续轮询。
 */
export class CheerProxyError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`cheer proxy HTTP ${status}`);
    this.name = 'CheerProxyError';
    this.status = status;
  }
}

/**
 * 读票数，走**同源代理** /api/cheer（EdgeOne Pages Function，见 functions/api/cheer.js）。
 *
 * 不能直连官方 cheer/info：它强制 application/json（换任何简单 content-type 都返回 415，
 * GET+查询串 405），而 application/json 必然触发预检，我们的源又拿不到 CORS 放行——两头堵死。
 * 好在这个接口免登录，服务端代理不需要转发任何凭证，所以这里也不带 credentials。
 */
export async function fetchCheerInfo(t: CheerTarget): Promise<CheerInfo> {
  const qs = new URLSearchParams({
    matchId: t.matchId,
    redTeamId: t.redTeamId,
    blueTeamId: t.blueTeamId,
  });
  const res = await fetch(`${CHEER_PROXY_PATH}?${qs.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new CheerProxyError(res.status);
  const env = (await res.json()) as { data?: unknown } | null;
  return normalizeCheerInfo(env?.data);
}
