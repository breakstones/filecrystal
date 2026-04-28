import type { FileParserConfig } from '../types.js';

export interface CommonOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Unified vision/OCR model (one model powers both OCR and seal/signature checks). */
  visionModel?: string;
  textModel?: string;
  ocrProvider?: string;
  aliyunAccessKeyId?: string;
  aliyunAccessKeySecret?: string;
  aliyunOcrEndpoint?: string;
  aliyunOcrRegion?: string;
}

/**
 * Hard ceiling for the file-level parallelism of `extract` / `structure` when
 * neither `--concurrency` nor `FILECRYSTAL_FILE_CONCURRENCY` is set. Paired
 * with `min(fileCount, DEFAULT_FILE_CONCURRENCY)` so small batches don't
 * allocate idle scheduling slots.
 */
export const DEFAULT_FILE_CONCURRENCY = 20;

function envPositiveInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Resolve the CLI default for file-level concurrency.
 *   1. `FILECRYSTAL_FILE_CONCURRENCY` env overrides the built-in cap.
 *   2. Result is still clamped by the actual number of files (1 when empty).
 *
 * Invalid / non-positive env values are ignored silently — we fall back to
 * the code default rather than erroring out mid-batch.
 */
export function resolveFileConcurrency(fileCount: number): number {
  const cap = envPositiveInt('FILECRYSTAL_FILE_CONCURRENCY') ?? DEFAULT_FILE_CONCURRENCY;
  return Math.max(1, Math.min(fileCount || 1, cap));
}

/**
 * API-only config builder (no mock mode in CLI).
 * The single `--vision-model` flag drives both the OCR model and the
 * seal/signature vision model — the backend is the same.
 */
export function buildConfig(opts: CommonOptions): FileParserConfig {
  const provider = opts.ocrProvider ?? process.env.FILECRYSTAL_OCR_PROVIDER ?? 'openai-compat';
  const baseUrl = opts.baseUrl ?? process.env.FILECRYSTAL_MODEL_BASE_URL;
  const apiKey = opts.apiKey ?? process.env.FILECRYSTAL_MODEL_API_KEY;
  if (provider === 'openai-compat' && (!baseUrl || !apiKey)) {
    throw new Error(
      'API credentials required. Set --base-url / --api-key or ' +
        'FILECRYSTAL_MODEL_BASE_URL / FILECRYSTAL_MODEL_API_KEY env vars.',
    );
  }
  if (provider !== 'openai-compat' && provider !== 'aliyun-ocr') {
    throw new Error('Unsupported OCR provider. Use openai-compat or aliyun-ocr.');
  }
  const models: { ocr?: string; vision?: string; text?: string } = {};
  if (opts.visionModel) {
    models.ocr = opts.visionModel;
    models.vision = opts.visionModel;
  }
  if (opts.textModel) models.text = opts.textModel;

  const config: FileParserConfig = {
    mode: 'api',
    ocr: {
      provider,
    },
  };
  if (baseUrl && apiKey) config.openai = { baseUrl, apiKey, models };
  if (provider === 'aliyun-ocr') {
    config.ocr = {
      ...config.ocr,
      aliyun: {
        accessKeyId: opts.aliyunAccessKeyId ?? process.env.FILECRYSTAL_ALIYUN_ACCESS_KEY_ID,
        accessKeySecret:
          opts.aliyunAccessKeySecret ?? process.env.FILECRYSTAL_ALIYUN_ACCESS_KEY_SECRET,
        endpoint: opts.aliyunOcrEndpoint ?? process.env.FILECRYSTAL_ALIYUN_OCR_ENDPOINT,
        regionId: opts.aliyunOcrRegion ?? process.env.FILECRYSTAL_ALIYUN_OCR_REGION,
      },
    };
  }
  return config;
}

/** Always pretty-print JSON — human-readable by default. */
export function writeJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}
