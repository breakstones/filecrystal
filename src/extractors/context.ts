import type { OcrBackend } from '../ocr/backend.js';
import type { ResolvedConfig } from '../config.js';
import type { MetricsCollector } from '../metrics/collector.js';
import type { Limiter } from '../utils/concurrency.js';

export interface ExtractorContext {
  ocr: OcrBackend;
  visionOcr: OcrBackend;
  truncation: ResolvedConfig['truncation'];
  ocrConfig: ResolvedConfig['ocr'];
  /**
   * Process-scoped OCR/vision concurrency gate. Shared across all extractors
   * running within the same {@link FileParser} instance so that e.g. a 10-page
   * PDF doesn't starve when another small file has idle slots.
   */
  ocrLimiter: Limiter;
  detectSeals: boolean;
  fullPages: boolean;
  metrics: MetricsCollector;
  signal?: AbortSignal;
}
