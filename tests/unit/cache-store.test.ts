import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileCacheStore } from '../../src/cache/store.js';
import type { ParseResult } from '../../src/types.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'filecrystal-cache-test-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sample: ParseResult = {
  schemaVersion: '1.0',
  parsedAt: '2026-04-22T00:00:00.000Z',
  parserVersion: 'test',
  source: {
    filePath: '/x',
    fileName: 'x',
    fileFormat: 'xlsx',
    fileSizeMB: 0.01,
    fileHash: 'a'.repeat(64),
    truncated: false,
    uploadedAt: '2026-04-22T00:00:00.000Z',
  },
  raw: { fullText: 'hi' },
  metrics: {
    quality: {
      fieldCount: 0,
      fieldsAboveConfidence: 0,
      avgConfidence: 0,
      locatorResolveRate: 0,
      ocrCharsRecognized: 2,
      sealsDetected: 0,
      signaturesDetected: 0,
      warningsCount: 0,
    },
    performance: {
      totalMs: 1,
      extractMs: 1,
      ocrMs: 0,
      sealMs: 0,
      llmMs: 0,
      cacheHit: false,
      ocrConcurrencyPeak: 0,
      retries: 0,
      imagesProcessed: 0,
    },
    cost: { totalYuan: 0, callsByModel: {} },
  },
};

describe('createFileCacheStore', () => {
  it('returns null for a missing key', async () => {
    const store = createFileCacheStore(dir);
    expect(await store.get('nope')).toBeNull();
  });

  it('round-trips a ParseResult via atomic write', async () => {
    const store = createFileCacheStore(dir);
    await store.put('k1', sample);
    const hit = await store.get('k1');
    expect(hit?.source.fileHash).toBe(sample.source.fileHash);
  });
});
