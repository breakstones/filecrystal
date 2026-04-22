import type { ParsedRaw } from '../types.js';

export interface DocxExtractResult {
  raw: ParsedRaw;
  pageCount: number;
  truncated: boolean;
}

export async function extractDocx(_filePath: string): Promise<DocxExtractResult> {
  return {
    raw: {
      sections: [],
      fullText: '[docx-extractor placeholder — implement mammoth (docx) + word-extractor (doc fallback)]',
    },
    pageCount: 0,
    truncated: false,
  };
}
