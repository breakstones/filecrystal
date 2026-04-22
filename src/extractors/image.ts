import type { ParsedRaw } from '../types.js';

export interface ImageExtractResult {
  raw: ParsedRaw;
}

export async function extractImage(_filePath: string): Promise<ImageExtractResult> {
  return {
    raw: {
      pages: [
        {
          pageNo: 1,
          text: '[image-extractor placeholder — implement sharp preprocessing + OcrBackend]',
        },
      ],
    },
  };
}
