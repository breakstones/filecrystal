import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { FileParserError, ErrorCode } from './utils/errors.js';
import type { FileParserConfig } from './types.js';

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
    })
    .optional(),
  extraction: z
    .object({
      defaultTemperature: z.number().min(0).max(2).optional(),
      timeoutMs: z.number().int().positive().optional(),
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
  };
  extraction: {
    defaultTemperature: number;
    timeoutMs: number;
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
  const envBaseUrl = env.FILECRYSTAL_BASE_URL;
  const envApiKey = env.FILECRYSTAL_API_KEY;
  const envOcr = env.FILECRYSTAL_OCR_MODEL;
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
        ocr: rawOpenai.models.ocr ?? envOcr ?? 'qwen-vl-ocr-latest',
        vision: rawOpenai.models.vision ?? envVision ?? 'qwen-vl-max',
        text: rawOpenai.models.text ?? envText ?? 'qwen-plus',
      },
    };
  }

  if (cfg.mode === 'api' && !openai?.apiKey) {
    throw new FileParserError(
      ErrorCode.CONFIG_INVALID,
      'mode "api" requires openai.apiKey (or FILECRYSTAL_API_KEY env)',
    );
  }

  return {
    mode: cfg.mode,
    cacheDir: cfg.cacheDir ?? env.FILECRYSTAL_CACHE_DIR ?? join(tmpdir(), 'filecrystal-cache'),
    parserVersion: cfg.parserVersion ?? (cfg.mode === 'mock' ? 'mock-0.1.0' : 'api-0.1.0'),
    openai,
    ocr: {
      maxConcurrency: cfg.ocr?.maxConcurrency ?? 3,
      timeoutMs: cfg.ocr?.timeoutMs ?? 60_000,
      retries: cfg.ocr?.retries ?? 2,
      imageMaxLongEdge: cfg.ocr?.imageMaxLongEdge ?? 2000,
    },
    extraction: {
      defaultTemperature: cfg.extraction?.defaultTemperature ?? 0.1,
      timeoutMs: cfg.extraction?.timeoutMs ?? 60_000,
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
