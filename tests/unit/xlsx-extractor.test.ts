import { describe, expect, it, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { extractXlsx } from '../../src/extractors/xlsx.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');
const fixturePath = join(fixturesDir, 'sample.xlsx');

beforeAll(() => {
  mkdirSync(fixturesDir, { recursive: true });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['项目', '金额'],
    ['A', 100],
    ['B', 200],
    ['合计', 300],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '汇总');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  writeFileSync(fixturePath, buf);
});

describe('extractXlsx', () => {
  it('reads cells from an xlsx', async () => {
    const result = await extractXlsx(fixturePath);
    expect(result.sheetNames).toEqual(['汇总']);
    expect(result.raw.sheets).toBeDefined();
    const sheet = result.raw.sheets![0];
    expect(sheet.sheetName).toBe('汇总');
    expect(sheet.cells.length).toBe(8);
    const total = sheet.cells.find((c) => c.ref === 'B4');
    expect(total?.value).toBe(300);
  });

  it('builds a fullText with sheet!ref lines', async () => {
    const result = await extractXlsx(fixturePath);
    expect(result.raw.fullText).toContain('汇总!A1');
    expect(result.raw.fullText).toContain('汇总!B4: 300');
  });
});
