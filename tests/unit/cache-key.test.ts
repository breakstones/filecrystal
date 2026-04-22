import { describe, expect, it } from 'vitest';
import { buildCacheKey, fingerprintConfig } from '../../src/cache/key.js';

describe('buildCacheKey', () => {
  const fileHash = 'a'.repeat(64);

  it('produces a stable key given the same inputs', () => {
    const a = buildCacheKey(fileHash, 'cfg-1');
    const b = buildCacheKey(fileHash, 'cfg-1');
    expect(a).toBe(b);
  });

  it('differs when the prompt hash differs', () => {
    const a = buildCacheKey(fileHash, 'cfg-1', 'p1');
    const b = buildCacheKey(fileHash, 'cfg-1', 'p2');
    expect(a).not.toBe(b);
  });
});

describe('fingerprintConfig', () => {
  it('is deterministic for equal objects', () => {
    expect(fingerprintConfig({ a: 1, b: 2 })).toBe(fingerprintConfig({ a: 1, b: 2 }));
  });

  it('differs for different objects', () => {
    expect(fingerprintConfig({ a: 1 })).not.toBe(fingerprintConfig({ a: 2 }));
  });
});
