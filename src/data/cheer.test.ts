import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHEER_PROXY_PATH } from '../config';
import type { CheerTarget } from '../types';
import { CheerProxyError, fetchCheerInfo, normalizeCheerInfo } from './cheer';

const target: CheerTarget = {
  matchId: '31228',
  redTeamId: '3059',
  blueTeamId: '739',
  redLabel: 'A大学 Alpha',
  blueLabel: 'B大学 Beta',
};

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('normalizeCheerInfo', () => {
  it('keeps valid vote totals and degrades invalid values to zero', () => {
    expect(normalizeCheerInfo({ redVotes: 2628, blueVotes: 2397 })).toEqual({
      redVotes: 2628,
      blueVotes: 2397,
    });
    expect(normalizeCheerInfo({ redVotes: 'bad' })).toEqual({ redVotes: 0, blueVotes: 0 });
  });
});

describe('fetchCheerInfo', () => {
  it('reads totals through the same-origin proxy without credentials', async () => {
    const fetchMock = mockFetch({ data: { redVotes: 2628, blueVotes: 2397 } });

    await expect(fetchCheerInfo(target)).resolves.toEqual({ redVotes: 2628, blueVotes: 2397 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${CHEER_PROXY_PATH}?matchId=31228&redTeamId=3059&blueTeamId=739`,
      { cache: 'no-store' },
    );
  });

  it('preserves the proxy status for missing-function and upstream failures', async () => {
    mockFetch(null, 404);
    await expect(fetchCheerInfo(target)).rejects.toEqual(expect.objectContaining({
      name: 'CheerProxyError',
      status: 404,
    } satisfies Partial<CheerProxyError>));
  });
});
