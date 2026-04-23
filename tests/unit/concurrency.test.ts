import { describe, expect, it } from 'vitest';
import { createLimiter, retry } from '../../src/utils/concurrency.js';

describe('createLimiter', () => {
  it('limits in-flight operations to the given concurrency', async () => {
    const limit = createLimiter(2);
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () =>
      limit(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return 1;
      }),
    );
    const results = await Promise.all(tasks);
    expect(results).toHaveLength(10);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('handles concurrency < 1 by treating it as 1', async () => {
    const limit = createLimiter(0);
    const out = await limit(async () => 42);
    expect(out).toBe(42);
  });
});

describe('retry', () => {
  it('returns the first successful value', async () => {
    let called = 0;
    const result = await retry(
      async () => {
        called++;
        return 'ok';
      },
      { retries: 3 },
    );
    expect(result).toBe('ok');
    expect(called).toBe(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    let called = 0;
    const result = await retry(
      async () => {
        called++;
        if (called < 3) throw new Error('boom');
        return 'recovered';
      },
      { retries: 3, baseMs: 1 },
    );
    expect(result).toBe('recovered');
    expect(called).toBe(3);
  });

  it('rethrows after exhausting retries', async () => {
    let called = 0;
    await expect(
      retry(
        async () => {
          called++;
          throw new Error('persistent');
        },
        { retries: 2, baseMs: 1 },
      ),
    ).rejects.toThrow('persistent');
    expect(called).toBe(3);
  });
});
