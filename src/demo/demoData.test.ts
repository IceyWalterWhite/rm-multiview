import { describe, expect, it } from 'vitest';
import { demoCheer } from './demoData';

describe('demoCheer', () => {
  it('points preview actions at the current official live page', () => {
    expect(demoCheer.officialUrl).toBe('https://www.robomaster.com/live');
  });
});
