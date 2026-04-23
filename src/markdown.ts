import type { ParsedRaw, ParsedRawSheet, ParseResult } from './types.js';

/**
 * Render a {@link ParseResult} (or just its {@link ParsedRaw}) as a plain
 * Markdown document suitable for direct consumption by humans or LLMs.
 *
 * Layout rules:
 *  - PDF pages  → `## Page N` heading + per-page text
 *  - XLSX sheets → `## <sheetName>` heading + cells (table if dense,
 *    `**ref**: value` list otherwise)
 *  - DOCX sections → paragraphs separated by blank lines
 *  - Image → body text only
 *
 * The function is pure; no I/O.
 */
export function toMarkdown(result: ParseResult | { raw: ParsedRaw; source?: ParseResult['source'] }): string {
  const raw = result.raw;
  const title = 'source' in result && result.source?.fileName ? result.source.fileName : undefined;
  const header = title ? `# ${title}\n\n` : '';

  if (raw.pages && raw.pages.length > 0) {
    const pages = raw.pages
      .map((p) => `## Page ${p.pageNo}\n\n${(p.text ?? '').trim()}`)
      .join('\n\n');
    return header + pages + '\n';
  }

  if (raw.sheets && raw.sheets.length > 0) {
    const sheets = raw.sheets.map((s) => `## ${s.sheetName}\n\n${sheetToMarkdown(s)}`).join('\n\n');
    return header + sheets + '\n';
  }

  if (raw.sections && raw.sections.length > 0) {
    const body = raw.sections.map((sec) => (sec.text ?? '').trim()).join('\n\n');
    return header + body + '\n';
  }

  return header + (raw.fullText ?? '') + '\n';
}

function sheetToMarkdown(sheet: ParsedRawSheet): string {
  if (!sheet.cells || sheet.cells.length === 0) return '_(empty)_';

  const byRow = new Map<number, Map<string, unknown>>();
  const colSet = new Set<string>();
  for (const cell of sheet.cells) {
    const m = /^([A-Z]+)(\d+)$/.exec(cell.ref);
    if (!m) continue;
    const col = m[1]!;
    const row = Number(m[2]!);
    let rowMap = byRow.get(row);
    if (!rowMap) {
      rowMap = new Map();
      byRow.set(row, rowMap);
    }
    rowMap.set(col, cell.value);
    colSet.add(col);
  }

  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const cols = [...colSet].sort(compareExcelCol);

  // Density heuristic: if avg cells-per-row ≥ 2 and row count ≥ 2, render as
  // a Markdown table (nicer for tabular data). Otherwise render as a `ref:
  // value` list (nicer for the "document typed inside Excel" case we see in
  // 福轩 请款.xls where A-column holds long paragraphs).
  const cellsPerRow = sheet.cells.length / Math.max(1, rows.length);
  if (cellsPerRow >= 2 && rows.length >= 2) {
    return renderTable(rows, cols, byRow);
  }
  return renderList(sheet.cells);
}

function renderTable(
  rows: number[],
  cols: string[],
  byRow: Map<number, Map<string, unknown>>,
): string {
  const lines: string[] = [];
  lines.push(`| ${cols.join(' | ')} |`);
  lines.push(`| ${cols.map(() => '---').join(' | ')} |`);
  for (const r of rows) {
    const row = byRow.get(r);
    const cells = cols.map((c) => escapeCell(String(row?.get(c) ?? '')));
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

function renderList(cells: ParsedRawSheet['cells']): string {
  return cells.map((c) => `- **${c.ref}**: ${String(c.value ?? '').replace(/\n/g, ' ')}`).join('\n');
}

function escapeCell(s: string): string {
  // Pipe breaks markdown tables; newlines break row parsing in most renderers.
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function compareExcelCol(a: string, b: string): number {
  return a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length - b.length;
}
