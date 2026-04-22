import { describe, expect, it, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { createFileParser } from '../../src/index.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');
const fixturePath = join(fixturesDir, 'smoke.xlsx');

beforeAll(() => {
  mkdirSync(fixturesDir, { recursive: true });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['hello', 'world']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  writeFileSync(fixturePath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
});

describe('createFileParser (mock mode)', () => {
  it('parses an xlsx end-to-end without a prompt', async () => {
    const parser = createFileParser({ mode: 'mock' });
    const res = await parser.parse(fixturePath);
    expect(res.schemaVersion).toBe('1.0');
    expect(res.source.fileFormat).toBe('xlsx');
    expect(res.source.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.raw.sheets?.[0]?.cells.length).toBeGreaterThan(0);
    expect(res.extracted).toBeUndefined();
    expect(res.metrics.performance.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('returns mock extracted fields when a prompt is provided', async () => {
    const parser = createFileParser({ mode: 'mock' });
    const res = await parser.parse(fixturePath, { prompt: '# test prompt' });
    expect(res.extracted).toBeDefined();
    expect(res.extracted?.mockField?.value).toBe('[mock]');
  });
});
