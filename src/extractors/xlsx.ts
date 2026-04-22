import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import type { ParsedRaw, ParsedRawSheet } from '../types.js';

export interface XlsxExtractResult {
  raw: ParsedRaw;
  sheetNames: string[];
}

export async function extractXlsx(filePath: string): Promise<XlsxExtractResult> {
  const buf = await readFile(filePath);
  const workbook = XLSX.read(buf, { type: 'buffer', cellFormula: true, cellStyles: false });
  const sheets: ParsedRawSheet[] = [];
  const fullLines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const cells: ParsedRawSheet['cells'] = [];
    const ref = ws['!ref'];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
          const value =
            typeof cell.v === 'number' || typeof cell.v === 'boolean'
              ? cell.v
              : String(cell.v);
          const entry: ParsedRawSheet['cells'][number] = { ref: addr, value };
          if (cell.f) entry.formula = String(cell.f);
          cells.push(entry);
          fullLines.push(`${sheetName}!${addr}: ${String(cell.v)}`);
        }
      }
    }
    const merges = ws['!merges']?.map((m) => XLSX.utils.encode_range(m));
    const sheet: ParsedRawSheet = { sheetName, cells };
    if (merges && merges.length > 0) sheet.mergedRanges = merges;
    sheets.push(sheet);
  }

  return {
    raw: {
      sheets,
      fullText: fullLines.join('\n'),
    },
    sheetNames: workbook.SheetNames,
  };
}
