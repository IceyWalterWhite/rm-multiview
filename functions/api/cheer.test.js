import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestGet } from './cheer.js';

// 上游全程 mock：代理测试同样不连官方服务器
function mockUpstream(text, init = {}) {
  const fn = vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => text,
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const call = (qs) => onRequestGet({ request: { url: `https://rmlive.cn/api/cheer${qs}` } });
const OK = JSON.stringify({ data: { redVotes: 2628, blueVotes: 2397 }, code: 'S0000', success: true });
const IDS = '?matchId=31228&redTeamId=3059&blueTeamId=739';

afterEach(() => { vi.unstubAllGlobals(); });

describe('GET /api/cheer', () => {
  it('POSTs application/json upstream and passes the envelope straight through', async () => {
    // 服务端到服务端没有 CORS 预检问题，所以这里可以（也必须）用 json——上游换别的 content-type 是 415
    const fetchMock = mockUpstream(OK);
    const res = await call(IDS);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://saas.robomaster.com/registration/cheer/info');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ matchId: '31228', redTeamId: '3059', blueTeamId: '739' });
    expect(init.credentials).toBeUndefined(); // 免登录接口，不转发任何凭证

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store'); // 票数是实时值
    expect(await res.json()).toEqual(JSON.parse(OK));
  });

  it('rejects non-numeric ids without touching the upstream (不做开放代理)', async () => {
    const fetchMock = mockUpstream(OK);
    const res = await call('?matchId=https://evil.example&redTeamId=1&blueTeamId=2');
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing ids', async () => {
    const fetchMock = mockUpstream(OK);
    expect((await call('?matchId=31228')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('folds any upstream failure into 502, keeping 404 to mean "函数没部署"', async () => {
    mockUpstream('nope', { ok: false, status: 404 });
    const res = await call(IDS);
    expect(res.status).toBe(502);
  });

  it('returns 502 when the upstream is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const res = await call(IDS);
    expect(res.status).toBe(502);
    expect((await res.json()).success).toBe(false);
  });
});
