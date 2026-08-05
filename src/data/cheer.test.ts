import { describe, it, expect, vi, afterEach } from 'vitest';
import { CheerProxyError, fetchCheerInfo, normalizeCheerInfo } from './cheer';
import { CHEER_PROXY_PATH } from '../config';
import type { CheerTarget } from '../types';

// 全程 mock：绝不向官方服务器发真实请求
function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fn = vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }) as unknown as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const target: CheerTarget = {
  matchId: '31228', redTeamId: '3059', blueTeamId: '739',
  redLabel: 'A大学 Alpha', blueLabel: 'B大学 Beta',
};

// 实测响应形状（代理原样透传官方信封）
const INFO = {
  data: { matchId: 31228, redTeamId: 3059, blueTeamId: 739, redVotes: 2628, blueVotes: 2397, voteEnabled: true },
  code: 'S0000', msg: '', success: true,
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('normalizeCheerInfo', () => {
  it('keeps only the three fields we render', () => {
    expect(normalizeCheerInfo(INFO.data)).toEqual({ redVotes: 2628, blueVotes: 2397, voteEnabled: true });
  });
  it('degrades missing/garbage payloads to zeros instead of NaN', () => {
    expect(normalizeCheerInfo(null)).toEqual({ redVotes: 0, blueVotes: 0, voteEnabled: false });
    expect(normalizeCheerInfo({ redVotes: 'x' })).toEqual({ redVotes: 0, blueVotes: 0, voteEnabled: false });
  });
});

describe('fetchCheerInfo', () => {
  it('reads through the same-origin proxy with the three ids in the query string', async () => {
    // 直连官方 cheer/info 会被 CORS 预检挡死（且它强制 json），所以这里必须是同源 GET
    const fn = mockFetch(INFO);
    await expect(fetchCheerInfo(target)).resolves.toEqual({ redVotes: 2628, blueVotes: 2397, voteEnabled: true });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe(`${CHEER_PROXY_PATH}?matchId=31228&redTeamId=3059&blueTeamId=739`);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.credentials).toBeUndefined(); // 免登录接口，不借用户凭证
  });

  it('reports a missing proxy (404) as a distinguishable status', async () => {
    // 本地 vite dev 没有 Pages Functions：上层据此彻底关掉助威，而不是每 10 秒重试一次
    mockFetch(null, { ok: false, status: 404 });
    const e = await fetchCheerInfo(target).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(CheerProxyError);
    expect((e as CheerProxyError).status).toBe(404);
  });

  it('throws on upstream failure (502) too', async () => {
    mockFetch(null, { ok: false, status: 502 });
    await expect(fetchCheerInfo(target)).rejects.toMatchObject({ name: 'CheerProxyError', status: 502 });
  });
});
