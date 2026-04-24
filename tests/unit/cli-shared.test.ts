import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FILE_CONCURRENCY,
  resolveFileConcurrency,
} from '../../src/cli/shared.js';

describe('resolveFileConcurrency', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FILECRYSTAL_FILE_CONCURRENCY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses DEFAULT_FILE_CONCURRENCY (=20) when env is unset', () => {
    expect(DEFAULT_FILE_CONCURRENCY).toBe(20);
    expect(resolveFileConcurrency(100)).toBe(20);
  });

  it('clamps down to the file count when fewer than the cap', () => {
    expect(resolveFileConcurrency(5)).toBe(5);
    expect(resolveFileConcurrency(1)).toBe(1);
  });

  it('returns 1 when fileCount is 0 (defensive minimum)', () => {
    expect(resolveFileConcurrency(0)).toBe(1);
  });

  it('FILECRYSTAL_FILE_CONCURRENCY raises the cap', () => {
    process.env.FILECRYSTAL_FILE_CONCURRENCY = '50';
    expect(resolveFileConcurrency(100)).toBe(50);
    expect(resolveFileConcurrency(8)).toBe(8); // still clamped by file count
  });

  it('FILECRYSTAL_FILE_CONCURRENCY lowers the cap below default', () => {
    process.env.FILECRYSTAL_FILE_CONCURRENCY = '4';
    expect(resolveFileConcurrency(100)).toBe(4);
  });

  it('ignores invalid env values and falls back to default', () => {
    for (const bad of ['0', '-5', 'abc', '']) {
      process.env.FILECRYSTAL_FILE_CONCURRENCY = bad;
      expect(resolveFileConcurrency(100)).toBe(20);
    }
  });
});
