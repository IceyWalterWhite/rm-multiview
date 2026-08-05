import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_CHANNEL, BRIDGE_VERSION, type BridgeRequest, type BridgeResponse } from './officialBridge';

const sourcePath = resolve(process.cwd(), 'public/rmlive-companion.user.js');
const ORIGIN = 'https://rmlive.cn';

interface MockXhrResponse {
  status: number;
  response: unknown;
  responseText: string;
}

function request<A extends BridgeRequest['action']>(id: string, action: A, payload: unknown): BridgeRequest {
  return {
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_VERSION,
    direction: 'page-to-script',
    id,
    action,
    payload,
  } as BridgeRequest;
}

function harness({ sandboxed = false }: { sandboxed?: boolean } = {}) {
  const posted: Array<{ message: BridgeResponse; origin: string }> = [];
  let listener: ((event: MessageEvent) => void) | null = null;
  const page = {
    location: { origin: ORIGIN },
    addEventListener: vi.fn((type: string, fn: (event: MessageEvent) => void) => {
      if (type === 'message') listener = fn;
    }),
    postMessage: vi.fn((message: BridgeResponse, origin: string) => posted.push({ message, origin })),
  };
  const xhr = vi.fn(async (options: Record<string, unknown>): Promise<MockXhrResponse> => {
    void options;
    return {
      status: 200,
      response: { success: true, code: 'S0000', data: {} },
      responseText: '',
    };
  });
  // Tampermonkey 只要脚本带了 @grant 就把它放进沙箱：此时脚本拿到的 `window` 是页面 window
  // 的 Proxy，而浏览器填进 event.source 的是**原始** window，两者 !== 。sandboxed 模式复现这一点。
  // 不复现的话，window === unsafeWindow，`event.source !== window` 天然成立，
  // 这个曾把整条消息通道焊死的缺陷就永远测不出来。
  const scriptWindow = sandboxed ? new Proxy(page, {}) : page;
  const context = vm.createContext({
    window: scriptWindow,
    unsafeWindow: page,
    GM: {
      info: { script: { version: '0.1.1' }, scriptHandler: 'Tampermonkey' },
      xmlHttpRequest: xhr,
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Math,
    Promise,
  });
  vm.runInContext(readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  if (!listener) throw new Error('userscript did not install a message listener');

  const send = (message: BridgeRequest, origin = ORIGIN, source: unknown = page) => {
    listener?.({ data: message, origin, source } as MessageEvent);
  };
  const responseFor = async (id: string): Promise<BridgeResponse> => {
    await vi.waitFor(() => expect(posted.some((item) => item.message.id === id)).toBe(true));
    return posted.find((item) => item.message.id === id)!.message;
  };
  return { page, scriptWindow, xhr, posted, send, responseFor };
}

describe('rmlive companion userscript', () => {
  it('declares only the production hosts and minimum Tampermonkey permissions', () => {
    const source = readFileSync(sourcePath, 'utf8');
    expect(source.match(/^\/\/ @match\s+.+$/gm)).toEqual([
      '// @match        https://rmlive.cn/*',
      '// @match        https://www.rmlive.cn/*',
    ]);
    expect(source.match(/^\/\/ @grant\s+.+$/gm)).toEqual(['// @grant        GM.xmlHttpRequest']);
    expect(source.match(/^\/\/ @connect\s+.+$/gm)).toEqual(['// @connect      saas.robomaster.com']);
    expect(source).toContain('// @noframes');
    expect(source).not.toMatch(/localhost|GM_cookie|document\.cookie|localStorage/);
  });

  it('answers probe requests without touching the official service', async () => {
    const h = harness();
    h.send(request('probe-1', 'probe', {}));
    expect(await h.responseFor('probe-1')).toMatchObject({
      ok: true,
      data: { scriptVersion: '0.1.1', manager: 'Tampermonkey' },
    });
    expect(h.xhr).not.toHaveBeenCalled();
    expect(h.posted[0].origin).toBe(ORIGIN);
  });

  // 2026-08-05 EdgeOne 预览环境实测：脚本在跑、消息也到得了，却一律不应答。
  // 根因是守卫写成了 `event.source !== window`，而 Tampermonkey 沙箱里 window 是 Proxy、
  // event.source 是原始 window，该条件恒真 —— 通道被自己的安全检查焊死。
  it('still answers when Tampermonkey sandboxes window (event.source is the raw window)', async () => {
    const h = harness({ sandboxed: true });
    // 前置断言：不这样，这个用例会悄悄退化成普通用例，测不到沙箱。
    expect(h.scriptWindow).not.toBe(h.page);

    h.send(request('probe-sandboxed', 'probe', {}), ORIGIN, h.page);
    expect(await h.responseFor('probe-sandboxed')).toMatchObject({
      ok: true,
      data: { scriptVersion: '0.1.1', manager: 'Tampermonkey' },
    });
  });

  // 放行沙箱不等于放行别人：跨窗口来的消息必须照旧丢弃。
  it('still drops messages that come from a different window', async () => {
    const h = harness({ sandboxed: true });
    h.send(request('foreign-1', 'probe', {}), ORIGIN, { imposter: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.posted.some((item) => item.message.id === 'foreign-1')).toBe(false);
  });

  it('sends a fixed JSON vote request with the official first-party cookie partition', async () => {
    const h = harness();
    h.xhr.mockResolvedValueOnce({
      status: 200,
      response: {
        success: true,
        code: 'S0000',
        data: { redVotes: 10, blueVotes: 20, voteEnabled: true, secret: 'must-not-cross' },
        internal: 'must-not-cross',
      },
      responseText: '',
    });
    h.send(request('vote-1', 'vote', { matchId: '31228', teamId: '3059', count: 3 }));
    const res = await h.responseFor('vote-1');

    expect(h.xhr).toHaveBeenCalledTimes(1);
    expect(h.xhr.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      url: 'https://saas.robomaster.com/registration/cheer/vote',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ matchId: '31228', teamId: '3059', count: 3 }),
      responseType: 'json',
      timeout: 10_000,
      anonymous: false,
      cookiePartition: { topLevelSite: 'https://www.robomaster.com' },
    });
    expect(res).toMatchObject({ ok: true, data: { redVotes: 10, blueVotes: 20, voteEnabled: true } });
    expect(JSON.stringify(res)).not.toContain('secret');
    expect(JSON.stringify(res)).not.toContain('internal');
  });

  it('rejects spoofed origins, unknown actions, and invalid ids without a network request', async () => {
    const h = harness();
    h.send(request('spoofed', 'heartbeat', { zoneId: '617' }), 'https://evil.example');
    h.send(request('unknown', 'eraseEverything' as BridgeRequest['action'], {}));
    h.send(request('invalid', 'vote', { matchId: 'https://evil.example', teamId: '1', count: 1 }));

    const unknown = await h.responseFor('unknown');
    const invalid = await h.responseFor('invalid');
    expect(h.posted.some((item) => item.message.id === 'spoofed')).toBe(false);
    expect(unknown).toMatchObject({ ok: false, error: { code: 'BRIDGE_ACTION_DENIED' } });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'BRIDGE_INVALID_PAYLOAD' } });
    expect(h.xhr).not.toHaveBeenCalled();
  });

  it('rate-limits heartbeat and each match/team vote key independently', async () => {
    const h = harness();
    h.send(request('heart-1', 'heartbeat', { zoneId: '617' }));
    await h.responseFor('heart-1');
    h.send(request('heart-2', 'heartbeat', { zoneId: '617' }));
    expect(await h.responseFor('heart-2')).toMatchObject({ ok: false, error: { code: 'BRIDGE_RATE_LIMIT' } });

    h.send(request('red-1', 'vote', { matchId: '31228', teamId: '3059', count: 1 }));
    await h.responseFor('red-1');
    h.send(request('red-2', 'vote', { matchId: '31228', teamId: '3059', count: 1 }));
    h.send(request('blue-1', 'vote', { matchId: '31228', teamId: '739', count: 1 }));
    expect(await h.responseFor('red-2')).toMatchObject({ ok: false, error: { code: 'BRIDGE_RATE_LIMIT' } });
    expect(await h.responseFor('blue-1')).toMatchObject({ ok: true });
    expect(h.xhr).toHaveBeenCalledTimes(3); // heartbeat + first red + first blue
  });

  it('returns sanitized official business errors', async () => {
    const h = harness();
    h.xhr.mockResolvedValueOnce({
      status: 200,
      response: { success: false, code: 'B200000', msg: '请登录后再操作', data: { token: 'nope' } },
      responseText: '',
    });
    h.send(request('progress-1', 'getWatchProgress', {}));
    const res = await h.responseFor('progress-1');
    expect(res).toEqual(expect.objectContaining({
      ok: false,
      error: { code: 'B200000', message: '请登录后再操作' },
    }));
    expect(JSON.stringify(res)).not.toContain('token');
  });
});
