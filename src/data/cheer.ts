import { CHEER_PROXY_PATH } from '../config';
import type { CheerInfo, CheerTarget } from '../types';

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeCheerInfo(value: unknown): CheerInfo {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    redVotes: count(data.redVotes),
    blueVotes: count(data.blueVotes),
  };
}

export class CheerProxyError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`cheer proxy HTTP ${status}`);
    this.name = 'CheerProxyError';
    this.status = status;
  }
}

export async function fetchCheerInfo(target: CheerTarget): Promise<CheerInfo> {
  const params = new URLSearchParams({
    matchId: target.matchId,
    redTeamId: target.redTeamId,
    blueTeamId: target.blueTeamId,
  });
  const response = await fetch(`${CHEER_PROXY_PATH}?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) throw new CheerProxyError(response.status);
  const envelope = await response.json() as { data?: unknown } | null;
  return normalizeCheerInfo(envelope?.data);
}
