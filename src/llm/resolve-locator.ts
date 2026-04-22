import type { ParsedRaw, SourceLocator } from '../types.js';

const SHEET_CELL = /^([^!]+)!([A-Z]+\d+(?::[A-Z]+\d+)?)$/;
const PDF_LINE = /第\s*(\d+)\s*页(?:第\s*(\d+)\s*行)?/;
const DOC_ANCHOR = /段落\s*(p-\d+|\w+)/;

export interface ResolvedLocator {
  locator?: SourceLocator;
  confidencePenalty: number;
}

export function resolveLocator(hint: string | undefined, raw: ParsedRaw): ResolvedLocator {
  if (!hint) return { confidencePenalty: 1 };

  const cellMatch = hint.match(SHEET_CELL);
  if (cellMatch) {
    const [, sheet, ref] = cellMatch;
    const exists = raw.sheets?.some(
      (s) => s.sheetName === sheet && s.cells.some((c) => c.ref === ref),
    );
    if (exists) {
      return { locator: { kind: 'sheet-cell', sheet, ref }, confidencePenalty: 1 };
    }
    return { locator: { kind: 'sheet-cell', sheet, ref }, confidencePenalty: 0.5 };
  }

  const pdfMatch = hint.match(PDF_LINE);
  if (pdfMatch) {
    const pageNo = Number(pdfMatch[1]);
    const lineNo = pdfMatch[2] ? Number(pdfMatch[2]) : undefined;
    const exists = raw.pages?.some((p) => p.pageNo === pageNo);
    const locator: SourceLocator = { kind: 'pdf-line', pageNo };
    if (lineNo !== undefined) locator.lineNo = lineNo;
    return { locator, confidencePenalty: exists ? 1 : 0.5 };
  }

  const docMatch = hint.match(DOC_ANCHOR);
  if (docMatch) {
    const sectionId = docMatch[1];
    const exists = raw.sections?.some((s) => s.sectionId === sectionId);
    return { locator: { kind: 'doc-anchor', sectionId }, confidencePenalty: exists ? 1 : 0.5 };
  }

  return { confidencePenalty: 0.5 };
}
