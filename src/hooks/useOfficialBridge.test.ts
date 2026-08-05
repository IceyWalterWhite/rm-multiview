import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OfficialBridgeClient, OfficialBridgeStatus } from '../net/officialBridge';
import { useOfficialBridge } from './useOfficialBridge';

function fakeClient(probe: () => Promise<{ scriptVersion: string; manager: string }>) {
  let status: OfficialBridgeStatus = 'probing';
  const listeners = new Set<() => void>();
  const client: OfficialBridgeClient = {
    getStatus: () => status,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    probe: vi.fn(async () => {
      try {
        const metadata = await probe();
        status = 'ready';
        listeners.forEach((listener) => listener());
        return metadata;
      } catch (error) {
        status = 'missing';
        listeners.forEach((listener) => listener());
        throw error;
      }
    }),
    request: vi.fn(async () => ({})),
    close: vi.fn(),
  };
  return client;
}

describe('useOfficialBridge', () => {
  it('probes once, exposes a bound request function, and closes on unmount', async () => {
    const client = fakeClient(async () => ({ scriptVersion: '0.1.0', manager: 'Tampermonkey' }));
    const { result, rerender, unmount } = renderHook(() => useOfficialBridge(true, () => client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    const readyApi = result.current;
    rerender();
    expect(result.current).toBe(readyApi);
    await act(async () => { await result.current.request('heartbeat', { zoneId: '617' }); });
    expect(client.request).toHaveBeenCalledWith('heartbeat', { zoneId: '617' });
    unmount();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('can retry a missing script probe and stays inert when disabled', async () => {
    let attempt = 0;
    const client = fakeClient(async () => {
      if (attempt++ === 0) throw new Error('missing');
      return { scriptVersion: '0.1.0', manager: 'Tampermonkey' };
    });
    const { result } = renderHook(() => useOfficialBridge(true, () => client));
    await act(async () => {});
    expect(result.current.status).toBe('missing');
    await act(async () => { await result.current.retry(); });
    expect(result.current.status).toBe('ready');

    const create = vi.fn(() => client);
    const disabled = renderHook(() => useOfficialBridge(false, create));
    expect(disabled.result.current.status).toBe('missing');
    expect(create).not.toHaveBeenCalled();
  });
});
