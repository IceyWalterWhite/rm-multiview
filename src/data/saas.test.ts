import { describe, it, expect, vi, afterEach } from 'vitest';
import { postSaas, SaasError, toNum } from './saas';

// 全部走 mock：数据层测试绝不真连官方服务器（读接口也不连）
function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fn = vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }) as unknown as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('postSaas', () => {
  it('unwraps data when success is true', async () => {
    mockFetch({ data: { redVotes: 2628 }, code: 'S0000', msg: '', success: true });
    await expect(postSaas('https://x/api', { a: 1 })).resolves.toEqual({ redVotes: 2628 });
  });

  it('sends a JSON body under Content-Type: text/plain (唯一能带凭证跑通的形态)', async () => {
    // 回归护栏：改成 application/json 会触发预检，而我们的源拿不到 CORS 放行 → 整个功能挂掉
    const fn = mockFetch({ data: {}, success: true });
    await postSaas('https://x/api', { matchId: '1' });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x/api');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(init.body).toBe('{"matchId":"1"}');
  });

  it('throws SaasError carrying the code when success is false', async () => {
    mockFetch({ code: 1002, msg: '请补全个人信息', success: false });
    await expect(postSaas('https://x/api', {})).rejects.toMatchObject({
      name: 'SaasError', code: 1002, message: '请补全个人信息',
    });
  });

  it('flags both unauthenticated codes as needLogin', async () => {
    mockFetch({ code: 'B200000', msg: '请登录后再操作', success: false });
    const e1 = await postSaas('https://x/api', {}).catch((e: unknown) => e);
    expect((e1 as SaasError).needLogin).toBe(true);

    mockFetch({ code: 1001, msg: '未登录', success: false });
    const e2 = await postSaas('https://x/api', {}).catch((e: unknown) => e);
    expect((e2 as SaasError).needLogin).toBe(true);

    mockFetch({ code: 9999, msg: '活动已结束', success: false });
    const e3 = await postSaas('https://x/api', {}).catch((e: unknown) => e);
    expect((e3 as SaasError).needLogin).toBe(false);
  });

  it('throws on non-2xx without parsing the body', async () => {
    mockFetch({ success: true }, { ok: false, status: 500 });
    await expect(postSaas('https://x/api', {})).rejects.toThrow(SaasError);
  });
});

describe('toNum', () => {
  it('coerces and defaults non-numbers to 0', () => {
    expect(toNum('12')).toBe(12);
    expect(toNum(undefined)).toBe(0);
    expect(toNum('abc')).toBe(0);
    expect(toNum(null)).toBe(0);
  });
});
