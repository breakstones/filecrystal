import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { FileParserError, ErrorCode } from './utils/errors.js';
import type { FileParserConfig } from './types.js';
import { VERSION } from './version.js';

const openaiSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  models: z.object({
    ocr: z.string().min(1).optional(),
    vision: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  }),
});

const configSchema = z.object({
  mode: z.enum(['mock', 'api']),
  cacheDir: z.string().optional(),
  parserVersion: z.string().optional(),
  openai: openaiSchema.optional(),
  ocr: z
    .object({
      maxConcurrency: z.number().int().positive().optional(),
      timeoutMs: z.number().int().positive().optional(),
      retries: z.number().int().nonnegative().optional(),
      imageMaxLongEdge: z.number().int().positive().optional(),
      /**
       * Enable DashScope's Qwen3 thinking mode (reasoning) on OCR calls.
       * Forwarded as `enable_thinking: true` in the request body.
       * Default: false (standard non-reasoning mode).
       */
      enableThinking: z.boolean().optional(),
    })
    .optional(),
  extraction: z
    .object({
      defaultTemperature: z.number().min(0).max(2).optional(),
      timeoutMs: z.number().int().positive().optional(),
      /**
       * Enable DashScope's Qwen3 thinking mode for the text/structure model.
       * Forwarded as `enable_thinking: true` on every structure-stage LLM call.
       * Default: false.
       */
      enableThinking: z.boolean().optional(),
    })
    .optional(),
  seal: z
    .object({
      enabled: z.boolean().optional(),
      mergeWithOcr: z.boolean().optional(),
    })
    .optional(),
  truncation: z
    .object({
      maxPages: z.number().int().positive().optional(),
      headTailRatio: z.tuple([z.number().positive(), z.number().positive()]).optional(),
      docxMaxChars: z.number().int().positive().optional(),
    })
    .optional(),
});

export const QWEN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export interface ResolvedConfig {
  mode: 'mock' | 'api';
  cacheDir: string;
  parserVersion: string;
  openai?: {
    baseUrl: string;
    apiKey: string;
    models: { ocr: string; vision: string; text: string };
  };
  ocr: {
    maxConcurrency: number;
    timeoutMs: number;
    retries: number;
    imageMaxLongEdge: number;
    enableThinking: boolean;
  };
  extraction: {
    defaultTemperature: number;
    timeoutMs: number;
    enableThinking: boolean;
  };
  seal: {
    enabled: boolean;
    mergeWithOcr: boolean;
  };
  truncation: {
    maxPages: number;
    headTailRatio: [number, number];
    docxMaxChars: number;
  };
}

export function resolveConfig(input: FileParserConfig): ResolvedConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    throw new FileParserError(ErrorCode.CONFIG_INVALID, 'FileParserConfig validation failed', {
      issues: parsed.error.issues,
    });
  }
  const cfg = parsed.data;

  const env = process.env;
  const envBaseUrl = env.FILECRYSTAL_MODEL_BASE_URL;
  const envApiKey = env.FILECRYSTAL_MODEL_API_KEY;
  // FILECRYSTAL_VISION_MODEL drives both the OCR model and the dedicated
  // vision model (seal/signature detection). If you need them split, pass
  // `openai.models` explicitly via FileParserConfig (library API).
  const envVision = env.FILECRYSTAL_VISION_MODEL;
  const envText = env.FILECRYSTAL_TEXT_MODEL;

  const rawOpenai = cfg.openai ?? (envBaseUrl && envApiKey
    ? { baseUrl: envBaseUrl, apiKey: envApiKey, models: {} }
    : undefined);

  let openai: ResolvedConfig['openai'];
  if (rawOpenai) {
    openai = {
      baseUrl: rawOpenai.baseUrl ?? envBaseUrl ?? QWEN_DEFAULT_BASE_URL,
      apiKey: rawOpenai.apiKey ?? envApiKey ?? '',
      models: {
        // envVision applies to both slots (single unified model).
        ocr: rawOpenai.models.ocr ?? envVision ?? 'qwen-vl-ocr-latest',
        vision: rawOpenai.models.vision ?? envVision ?? 'qwen-vl-max',
        text: rawOpenai.models.text ?? envText ?? 'qwen3.6-plus',
      },
    };
  }

  if (cfg.mode === 'api' && !openai?.apiKey) {
    throw new FileParserError(
      ErrorCode.CONFIG_INVALID,
      'api mode requires openai.apiKey (or FILECRYSTAL_MODEL_API_KEY env)',
    );
  }

  return {
    mode: cfg.mode,
    cacheDir: cfg.cacheDir ?? env.FILECRYSTAL_CACHE_DIR ?? join(tmpdir(), 'filecrystal-cache'),
    parserVersion: cfg.parserVersion ?? (cfg.mode === 'mock' ? `mock-${VERSION}` : `api-${VERSION}`),
    openai,
    ocr: {
      // Process-scoped OCR concurrency (see FileParserImpl.ocrLimiter). With
      // T1 this is no longer per-file; we keep raising the default while
      // relying on T6's jitter+Retry-After to ride out the rate limit if hit.
      maxConcurrency: cfg.ocr?.maxConcurrency ?? 18,
      // Latency budget per attempt. The hedged-fetch in the OCR backend
      // (see `speculativeAfterMs`) handles p95 tail by firing a second
      // request after 8 s; Promise.any returns whichever fulfils first.
      // 45 s lets the slower of the two still finish before we give up.
      timeoutMs: cfg.ocr?.timeoutMs ?? 45_000,
      retries: cfg.ocr?.retries ?? 2,
      imageMaxLongEdge: cfg.ocr?.imageMaxLongEdge ?? 2000,
      enableThinking:
        cfg.ocr?.enableThinking ?? env.FILECRYSTAL_VISION_MODEL_THINKING === 'true',
    },
    extraction: {
      defaultTemperature: cfg.extraction?.defaultTemperature ?? 0.1,
      timeoutMs: cfg.extraction?.timeoutMs ?? 60_000,
      enableThinking:
        cfg.extraction?.enableThinking ?? env.FILECRYSTAL_TEXT_MODEL_THINKING === 'true',
    },
    seal: {
      enabled: cfg.seal?.enabled ?? true,
      mergeWithOcr: cfg.seal?.mergeWithOcr ?? true,
    },
    truncation: {
      maxPages: cfg.truncation?.maxPages ?? 10,
      headTailRatio: cfg.truncation?.headTailRatio ?? [7, 3],
      docxMaxChars: cfg.truncation?.docxMaxChars ?? 5000,
    },
  };
}
