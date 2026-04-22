import type { OcrBackend } from '../ocr/backend.js';
import type { ResolvedConfig } from '../config.js';
import type { MetricsCollector } from '../metrics/collector.js';

export interface ExtractorContext {
  ocr: OcrBackend;
  visionOcr: OcrBackend;
  truncation: ResolvedConfig['truncation'];
  ocrConfig: ResolvedConfig['ocr'];
  detectSeals: boolean;
  fullPages: boolean;
  metrics: MetricsCollector;
  signal?: AbortSignal;
}
