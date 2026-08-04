import { describe, expect, it } from 'vitest';
import { CHEER_INFO_POLL_MS, CHEER_TARGET_POLL_MS } from './config';

describe('cheer polling intervals', () => {
  it('refreshes votes every 5 seconds', () => {
    expect(CHEER_INFO_POLL_MS).toBe(5_000);
  });

  it('refreshes the current match every 10 seconds', () => {
    expect(CHEER_TARGET_POLL_MS).toBe(10_000);
  });
});
