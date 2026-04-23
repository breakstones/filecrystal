import { describe, expect, it } from 'vitest';
import { createSealDetector } from '../../src/seal/detector.js';
import type { OcrBackend, OcrRequest, OcrResult } from '../../src/ocr/backend.js';
import type { SealDetection, SignatureDetection } from '../../src/types.js';

function makeVision(seals: SealDetection[], signatures: SignatureDetection[]): OcrBackend {
  return {
    async recognize(_req: OcrRequest): Promise<OcrResult> {
      return { text: '', blocks: [], seals, signatures, model: 'mock-vision', ms: 3 };
    },
  };
}

describe('createSealDetector', () => {
  it('passes detectSealsAndSignatures=true through to the backend', async () => {
    let captured: OcrRequest | undefined;
    const vision: OcrBackend = {
      async recognize(req: OcrRequest): Promise<OcrResult> {
        captured = req;
        return { text: '', blocks: [], seals: [], signatures: [], model: 'mock', ms: 0 };
      },
    };
    const detector = createSealDetector({ visionBackend: vision });
    await detector.detect(Buffer.from('png'), 3);
    expect(captured?.detectSealsAndSignatures).toBe(true);
    expect(captured?.pageNoHint).toBe(3);
  });

  it('forwards seals and signatures from the vision backend', async () => {
    const seal: SealDetection = {
      sealId: 's1',
      type: 'contract',
      confidence: 0.9,
      locator: { kind: 'pdf-bbox', pageNo: 1 },
    };
    const sig: SignatureDetection = {
      signatureId: 'sig1',
      type: 'handwritten',
      confidence: 0.8,
      locator: { kind: 'pdf-bbox', pageNo: 1 },
    };
    const detector = createSealDetector({ visionBackend: makeVision([seal], [sig]) });
    const result = await detector.detect(Buffer.from('png'));
    expect(result.seals).toEqual([seal]);
    expect(result.signatures).toEqual([sig]);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });
});
