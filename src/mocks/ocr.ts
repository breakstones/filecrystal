import type { OcrBackend, OcrRequest, OcrResult } from '../ocr/backend.js';

export function createMockOcrBackend(): OcrBackend {
  return {
    async recognize(req: OcrRequest): Promise<OcrResult> {
      return {
        text: '[mock-ocr] recognized text',
        blocks: [
          {
            blockId: 'b-1',
            text: '[mock-ocr] recognized text',
            bbox: [0, 0, 1, 1],
            confidence: 0.9,
          },
        ],
        seals: req.detectSealsAndSignatures ? [] : undefined,
        signatures: req.detectSealsAndSignatures ? [] : undefined,
        model: 'mock-ocr',
        ms: 1,
      };
    },
  };
}
