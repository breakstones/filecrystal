import type { ParsedRaw } from '../types.js';

export interface PdfExtractResult {
  raw: ParsedRaw;
  pageCount: number;
  pagesIncluded: number[];
  truncated: boolean;
}

export async function extractPdf(_filePath: string): Promise<PdfExtractResult> {
  return {
    raw: {
      pages: [],
      fullText: '[pdf-extractor placeholder — implement pdfjs-dist text layer + @napi-rs/canvas OCR fallback]',
    },
    pageCount: 0,
    pagesIncluded: [],
    truncated: false,
  };
}
