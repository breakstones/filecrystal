import type { SealDetection, SignatureDetection } from '../types.js';
import type { OcrBackend } from '../ocr/backend.js';

export interface SealDetectionResult {
  seals: SealDetection[];
  signatures: SignatureDetection[];
  ms: number;
}

export interface SealDetectorOptions {
  visionBackend: OcrBackend;
}

export function createSealDetector(opts: SealDetectorOptions) {
  return {
    async detect(imageBuffer: Buffer, pageNo?: number): Promise<SealDetectionResult> {
      const start = Date.now();
      const res = await opts.visionBackend.recognize({
        imageBuffer,
        detectSealsAndSignatures: true,
        pageNoHint: pageNo,
      });
      return {
        seals: res.seals ?? [],
        signatures: res.signatures ?? [],
        ms: Date.now() - start,
      };
    },
  };
}
