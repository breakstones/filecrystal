import type { SealDetection, SignatureDetection } from '../types.js';

export interface OcrBlock {
  blockId: string;
  text: string;
  bbox?: [number, number, number, number];
  confidence?: number;
}

export interface OcrResult {
  text: string;
  blocks: OcrBlock[];
  seals?: SealDetection[];
  signatures?: SignatureDetection[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    imageTokens?: number;
  };
  model: string;
  ms: number;
}

export interface OcrRequest {
  imageBuffer: Buffer;
  mimeType?: string;
  detectSealsAndSignatures?: boolean;
  pageNoHint?: number;
  signal?: AbortSignal;
}

export interface OcrBackend {
  recognize(req: OcrRequest): Promise<OcrResult>;
}
