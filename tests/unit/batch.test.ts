import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileParser } from '../../src/index.js';
import { parseMany } from '../../src/batch.js';
import { buildXlsx, ensureDir, fixturesDir } from '../helpers/fixtures.js';

let outDir: string;

beforeAll(() => {
  ensureDir();
  buildXlsx(join(fixturesDir, 'batch-a.xlsx'));
  buildXlsx(join(fixturesDir, 'batch-b.xlsx'));
  outDir = mkdtempSync(join(tmpdir(), 'filecrystal-batch-'));
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('parseMany', () => {
  it('parses multiple files concurrently and collects per-item results', async () => {
    const parser = createFileParser({ mode: 'mock' });
    const paths = [join(fixturesDir, 'batch-a.xlsx'), join(fixturesDir, 'batch-b.xlsx')];
    const res = await parseMany(parser, paths, { concurrency: 2 });
    expect(res.total).toBe(2);
    expect(res.ok).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.items.every((i) => i.result?.source.fileFormat === 'xlsx')).toBe(true);
  });

  it('writes <basename>.parsed.json to outDir when provided', async () => {
    const parser = createFileParser({ mode: 'mock' });
    const res = await parseMany(parser, [join(fixturesDir, 'batch-a.xlsx')], { outDir });
    expect(res.ok).toBe(1);
    const outFile = res.items[0]!.outFile!;
    expect(existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(parsed.source.fileFormat).toBe('xlsx');
  });

  it('records individual errors without aborting the batch', async () => {
    const parser = createFileParser({ mode: 'mock' });
    const res = await parseMany(
      parser,
      [join(fixturesDir, 'batch-a.xlsx'), '/does/not/exist.pdf'],
      { concurrency: 2 },
    );
    expect(res.total).toBe(2);
    expect(res.ok).toBe(1);
    expect(res.failed).toBe(1);
    const failed = res.items.find((i) => !i.ok)!;
    expect(failed.code).toBeDefined();
  });
});
