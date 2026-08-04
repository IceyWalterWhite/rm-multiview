import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from './cheer.js';

const IDS = '?matchId=31228&redTeamId=3059&blueTeamId=739';
const call = (query) => onRequestGet({ request: { url: `https://rmlive.cn/api/cheer${query}` } });

function mockUpstream(body, status = 200) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/cheer', () => {
  it('posts fixed JSON upstream and returns uncached official totals', async () => {
    const official = { code: 'S0000', data: { redVotes: 2628, blueVotes: 2397 } };
    const fetchMock = mockUpstream(official);

    const response = await call(IDS);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://saas.robomaster.com/registration/cheer/info',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: '31228', redTeamId: '3059', blueTeamId: '739' }),
      },
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual(official);
  });

  it('rejects invalid ids without becoming an open proxy', async () => {
    const fetchMock = mockUpstream({});
    const response = await call('?matchId=https://evil.example&redTeamId=1&blueTeamId=2');
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps upstream and network failures to 502', async () => {
    mockUpstream({}, 500);
    expect((await call(IDS)).status).toBe(502);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect((await call(IDS)).status).toBe(502);
  });
});
