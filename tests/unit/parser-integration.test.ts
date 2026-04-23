import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createFileParser } from '../../src/index.js';
import { buildTextPdf, buildXlsx, ensureDir, fixturesDir } from '../helpers/fixtures.js';

let cacheDir: string;

beforeAll(async () => {
  ensureDir();
  await buildTextPdf(join(fixturesDir, 'integration.pdf'), [
    'Integration page 1 with Alpha Project details.',
    'Integration page 2 total amount 987654.',
  ]);
  buildXlsx(join(fixturesDir, 'integration.xlsx'));
  cacheDir = mkdtempSync(join(tmpdir(), 'filecrystal-itest-'));
});

afterAll(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('createFileParser · PDF end-to-end in mock mode', () => {
  it(
    'produces pages, fileHash, and metrics',
    async () => {
      const parser = createFileParser({ mode: 'mock', cacheDir });
      const res = await parser.parse(join(fixturesDir, 'integration.pdf'));
      expect(res.source.fileFormat).toBe('pdf');
      expect(res.source.fileHash).toMatch(/^[a-f0-9]{64}$/);
      expect(res.raw.pages).toHaveLength(2);
      expect(res.raw.pages![0]!.text).toContain('Alpha');
      expect(res.metrics.performance.totalMs).toBeGreaterThanOrEqual(0);
    },
    30_000,
  );
});

describe('createFileParser · cache hit path', () => {
  it('the second parse returns cacheHit=true and the same shape', async () => {
    const parser = createFileParser({ mode: 'mock', cacheDir });
    const file = join(fixturesDir, 'integration.xlsx');
    const first = await parser.parse(file);
    expect(first.metrics.performance.cacheHit).toBe(false);
    const second = await parser.parse(file);
    expect(second.metrics.performance.cacheHit).toBe(true);
    expect(second.source.fileHash).toBe(first.source.fileHash);
  });

  it('force=true bypasses the cache', async () => {
    const parser = createFileParser({ mode: 'mock', cacheDir });
    const file = join(fixturesDir, 'integration.xlsx');
    await parser.parse(file);
    const forced = await parser.parse(file, { force: true });
    expect(forced.metrics.performance.cacheHit).toBe(false);
  });
});

describe('createFileParser · prompt drives LLM extraction', () => {
  it('produces an extracted map with locator resolve + confidence blending', async () => {
    const parser = createFileParser({ mode: 'mock', cacheDir });
    const prompt = `---
name: test
temperature: 0
---

dummy`;
    const res = await parser.parse(join(fixturesDir, 'integration.xlsx'), { prompt });
    expect(res.extracted).toBeDefined();
    expect(res.extracted!.mockField).toBeDefined();
    expect(res.metrics.quality.fieldCount).toBe(Object.keys(res.extracted!).length);
  });
});
