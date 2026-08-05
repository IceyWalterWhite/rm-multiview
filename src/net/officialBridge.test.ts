import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  OfficialBridgeError,
  createOfficialBridgeClient,
  type BridgeResponse,
} from './officialBridge';

const ORIGIN = 'https://rmlive.cn';

function reply(data: BridgeResponse, origin = ORIGIN, source: MessageEventSource | null = window) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

function response(id: string, over: Partial<BridgeResponse> = {}): BridgeResponse {
  return {
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_VERSION,
    direction: 'script-to-page',
    id,
    ok: true,
    data: {},
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('official userscript bridge client', () => {
  it('probes the userscript and transitions to ready', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const client = createOfficialBridgeClient({ target: window, origin: ORIGIN, timeoutMs: 100 });
    const seen: string[] = [];
    const unsubscribe = client.subscribe(() => seen.push(client.getStatus()));

    const pending = client.probe();
    const sent = post.mock.calls[0][0] as { id: string; action: string; direction: string };
    expect(sent).toMatchObject({ action: 'probe', direction: 'page-to-script' });
    expect(post.mock.calls[0][1]).toBe(ORIGIN);

    reply(response(sent.id, { data: { scriptVersion: '0.1.0', manager: 'Tampermonkey' } }));
    await expect(pending).resolves.toEqual({ scriptVersion: '0.1.0', manager: 'Tampermonkey' });
    expect(client.getStatus()).toBe('ready');
    expect(seen).toEqual(['ready']);

    unsubscribe();
    client.close();
  });

  it('ignores wrong origins, foreign windows, and unmatched response ids', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const client = createOfficialBridgeClient({ target: window, origin: ORIGIN, timeoutMs: 100 });
    const pending = client.probe();
    const id = (post.mock.calls[0][0] as { id: string }).id;

    reply(response(id), 'https://evil.example');
    reply(response(id), ORIGIN, null);
    reply(response('not-' + id));
    expect(client.getStatus()).toBe('probing');

    reply(response(id, { data: { scriptVersion: '0.1.0', manager: 'Tampermonkey' } }));
    await expect(pending).resolves.toMatchObject({ scriptVersion: '0.1.0' });
    client.close();
  });

  it('marks the bridge missing on probe timeout and ignores late replies', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const client = createOfficialBridgeClient({ target: window, origin: ORIGIN, timeoutMs: 50 });
    const pending = client.probe();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'BRIDGE_TIMEOUT' });
    const id = (post.mock.calls[0][0] as { id: string }).id;

    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(client.getStatus()).toBe('missing');

    reply(response(id, { data: { scriptVersion: 'late', manager: 'Tampermonkey' } }));
    expect(client.getStatus()).toBe('missing');
    client.close();
    vi.useRealTimers();
  });

  it('correlates concurrent requests and exposes sanitized bridge errors', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const client = createOfficialBridgeClient({ target: window, origin: ORIGIN, timeoutMs: 100 });
    const probe = client.probe();
    const probeId = (post.mock.calls[0][0] as { id: string }).id;
    reply(response(probeId, { data: { scriptVersion: '0.1.0', manager: 'Tampermonkey' } }));
    await probe;

    const progress = client.request('getWatchProgress', {});
    const heartbeat = client.request('heartbeat', { zoneId: '617' });
    const progressId = (post.mock.calls[1][0] as { id: string }).id;
    const heartbeatId = (post.mock.calls[2][0] as { id: string }).id;

    reply(response(heartbeatId, { ok: false, data: undefined, error: { code: 'B200000', message: '请登录后再操作' } }));
    reply(response(progressId, { data: { accumulatedSeconds: 420, tiers: [] } }));

    await expect(progress).resolves.toMatchObject({ accumulatedSeconds: 420 });
    await expect(heartbeat).rejects.toEqual(new OfficialBridgeError('请登录后再操作', 'B200000'));
    client.close();
  });

  it('rejects requests before the probe succeeds and aborts pending work on close', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const client = createOfficialBridgeClient({ target: window, origin: ORIGIN, timeoutMs: 100 });
    await expect(client.request('heartbeat', { zoneId: '617' }))
      .rejects.toMatchObject({ code: 'BRIDGE_NOT_READY' });

    const probe = client.probe();
    client.close();
    await expect(probe).rejects.toMatchObject({ code: 'BRIDGE_CLOSED' });
    expect(client.getStatus()).toBe('error');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
