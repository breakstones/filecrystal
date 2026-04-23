import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256File, sha256Buffer, sha256String } from '../../src/extractors/utils/file-hash.js';

describe('file-hash helpers', () => {
  it('hashes strings deterministically', () => {
    expect(sha256String('abc')).toBe(sha256String('abc'));
    expect(sha256String('abc')).not.toBe(sha256String('abd'));
    expect(sha256String('abc')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashes buffers deterministically', () => {
    expect(sha256Buffer(Buffer.from('hello'))).toBe(sha256Buffer(Buffer.from('hello')));
  });

  it('hashes files the same as buffers for equal content', async () => {
    const dir = tmpdir();
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `filecrystal-test-${Date.now()}.txt`);
    const payload = 'deterministic payload';
    writeFileSync(p, payload);
    const fromFile = await sha256File(p);
    const fromBuffer = sha256Buffer(Buffer.from(payload));
    expect(fromFile).toBe(fromBuffer);
  });
});
