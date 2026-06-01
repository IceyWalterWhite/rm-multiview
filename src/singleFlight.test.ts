import { describe, it, expect } from 'vitest';
import { singleFlight } from './singleFlight';

describe('singleFlight', () => {
  it('coalesces concurrent calls into a single execution', async () => {
    let runs = 0;
    let resolve!: (v: number) => void;
    const sf = singleFlight(() => { runs++; return new Promise<number>((r) => { resolve = r; }); });

    const p1 = sf();
    const p2 = sf();
    expect(runs).toBe(1); // both callers share the one in-flight run

    resolve(42);
    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
  });

  it('re-executes once the in-flight call has settled', async () => {
    let runs = 0;
    const sf = singleFlight(async () => { runs++; return runs; });
    expect(await sf()).toBe(1);
    expect(await sf()).toBe(2); // not coalesced — previous run already settled
    expect(runs).toBe(2);
  });

  it('clears the in-flight slot on rejection so a later call can retry', async () => {
    let runs = 0;
    const sf = singleFlight(async () => { runs++; if (runs === 1) throw new Error('boom'); return runs; });
    await expect(sf()).rejects.toThrow('boom');
    expect(await sf()).toBe(2);
  });
});
