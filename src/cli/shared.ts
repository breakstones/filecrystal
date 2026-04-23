import type { FileParserConfig } from '../types.js';

export interface CommonOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Unified vision/OCR model (one model powers both OCR and seal/signature checks). */
  visionModel?: string;
  textModel?: string;
}

/**
 * API-only config builder (no mock mode in CLI).
 * The single `--vision-model` flag drives both the OCR model and the
 * seal/signature vision model — the backend is the same.
 */
export function buildConfig(opts: CommonOptions): FileParserConfig {
  const baseUrl = opts.baseUrl ?? process.env.FILECRYSTAL_MODEL_BASE_URL;
  const apiKey = opts.apiKey ?? process.env.FILECRYSTAL_MODEL_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      'API credentials required. Set --base-url / --api-key or ' +
        'FILECRYSTAL_MODEL_BASE_URL / FILECRYSTAL_MODEL_API_KEY env vars.',
    );
  }
  const models: { ocr?: string; vision?: string; text?: string } = {};
  if (opts.visionModel) {
    models.ocr = opts.visionModel;
    models.vision = opts.visionModel;
  }
  if (opts.textModel) models.text = opts.textModel;
  return {
    mode: 'api',
    openai: { baseUrl, apiKey, models },
  };
}

/** Always pretty-print JSON — human-readable by default. */
export function writeJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}
