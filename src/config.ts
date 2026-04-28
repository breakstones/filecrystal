import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { FileParserError, ErrorCode } from './utils/errors.js';
import type { AliyunOcrConfig, FileParserConfig, OcrProvider } from './types.js';
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
      provider: z.enum(['openai-compat', 'aliyun-ocr']).optional(),
      aliyun: z
        .object({
          accessKeyId: z.string().min(1).optional(),
          accessKeySecret: z.string().min(1).optional(),
          endpoint: z.string().min(1).optional(),
          regionId: z.string().min(1).optional(),
          model: z.literal('RecognizeAdvanced').optional(),
          outputTable: z.boolean().optional(),
          row: z.boolean().optional(),
          paragraph: z.boolean().optional(),
        })
        .optional(),
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

export interface ResolvedOcrProviderConfig {
  provider: OcrProvider;
  model: string;
  openai?: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  aliyun?: Required<Pick<AliyunOcrConfig, 'accessKeyId' | 'accessKeySecret' | 'model'>> &
    Pick<AliyunOcrConfig, 'endpoint' | 'regionId' | 'outputTable' | 'row' | 'paragraph'>;
}

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
    provider: OcrProvider;
    primary: ResolvedOcrProviderConfig;
    vision: ResolvedOcrProviderConfig;
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

  // Read a positive integer from env; silently ignore missing / NaN /
  // non-positive values so bad config never aborts a batch mid-flight.
  const envPositiveInt = (name: string): number | undefined => {
    const raw = env[name];
    if (!raw) return undefined;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
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

  const ocrProvider = cfg.ocr?.provider ?? (env.FILECRYSTAL_OCR_PROVIDER as OcrProvider | undefined) ?? 'openai-compat';
  if (ocrProvider !== 'openai-compat' && ocrProvider !== 'aliyun-ocr') {
    throw new FileParserError(ErrorCode.CONFIG_INVALID, `Unsupported OCR provider: ${ocrProvider}`);
  }

  if (cfg.mode === 'api' && ocrProvider === 'openai-compat' && !openai?.apiKey) {
    throw new FileParserError(
      ErrorCode.CONFIG_INVALID,
      'api mode requires openai.apiKey (or FILECRYSTAL_MODEL_API_KEY env)',
    );
  }

  const primaryOcr = cfg.mode === 'mock'
    ? mockOcrProviderConfig('mock-ocr')
    : resolvePrimaryOcrProvider({ provider: ocrProvider, cfg, env, openai });
  const visionOcr = cfg.mode === 'mock'
    ? mockOcrProviderConfig('mock-vision')
    : resolveVisionOcrProvider({ cfg, env, openai });

  return {
    mode: cfg.mode,
    cacheDir: cfg.cacheDir ?? env.FILECRYSTAL_CACHE_DIR ?? join(tmpdir(), 'filecrystal-cache'),
    parserVersion: cfg.parserVersion ?? (cfg.mode === 'mock' ? `mock-${VERSION}` : `api-${VERSION}`),
    openai,
    ocr: {
      // Process-scoped OCR concurrency (see FileParserImpl.ocrLimiter). This
      // pool is shared across every page of every file flowing through one
      // parser instance. Resolution order:
      //   SDK `config.ocr.maxConcurrency`  >  env `FILECRYSTAL_OCR_CONCURRENCY`  >  default 24
      // 24 targets the typical DashScope paid-tier concurrency cap; lower it
      // via the env if you see 429s, raise it if you have a higher quota.
      maxConcurrency:
        cfg.ocr?.maxConcurrency ?? envPositiveInt('FILECRYSTAL_OCR_CONCURRENCY') ?? 24,
      // Latency budget per attempt. The hedged-fetch in the OCR backend
      // (see `speculativeAfterMs`) handles p95 tail by firing a second
      // request after 8 s; Promise.any returns whichever fulfils first.
      // 45 s lets the slower of the two still finish before we give up.
      timeoutMs: cfg.ocr?.timeoutMs ?? 45_000,
      retries: cfg.ocr?.retries ?? 2,
      imageMaxLongEdge: cfg.ocr?.imageMaxLongEdge ?? 2000,
      enableThinking:
        cfg.ocr?.enableThinking ?? env.FILECRYSTAL_VISION_MODEL_THINKING === 'true',
      provider: ocrProvider,
      primary: primaryOcr,
      vision: visionOcr,
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

function mockOcrProviderConfig(model: string): ResolvedOcrProviderConfig {
  return { provider: 'openai-compat', model };
}

function resolvePrimaryOcrProvider(args: {
  provider: OcrProvider;
  cfg: z.infer<typeof configSchema>;
  env: NodeJS.ProcessEnv;
  openai: ResolvedConfig['openai'];
}): ResolvedOcrProviderConfig {
  if (args.provider === 'openai-compat') {
    if (!args.openai?.apiKey) {
      throw new FileParserError(
        ErrorCode.CONFIG_INVALID,
        'api mode requires openai.apiKey (or FILECRYSTAL_MODEL_API_KEY env)',
      );
    }
    return {
      provider: 'openai-compat',
      model: args.openai.models.ocr,
      openai: {
        baseUrl: args.openai.baseUrl,
        apiKey: args.openai.apiKey,
        model: args.openai.models.ocr,
      },
    };
  }

  const aliyun = resolveAliyunConfig(args.cfg.ocr?.aliyun, args.env);
  return {
    provider: 'aliyun-ocr',
    model: aliyun.model,
    aliyun,
  };
}

function resolveVisionOcrProvider(args: {
  cfg: z.infer<typeof configSchema>;
  env: NodeJS.ProcessEnv;
  openai: ResolvedConfig['openai'];
}): ResolvedOcrProviderConfig {
  if (args.openai?.apiKey) {
    return {
      provider: 'openai-compat',
      model: args.openai.models.vision,
      openai: {
        baseUrl: args.openai.baseUrl,
        apiKey: args.openai.apiKey,
        model: args.openai.models.vision,
      },
    };
  }

  const aliyun = resolveAliyunConfig(args.cfg.ocr?.aliyun, args.env);
  return {
    provider: 'aliyun-ocr',
    model: aliyun.model,
    aliyun,
  };
}

function stripProtocol(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function resolveAliyunConfig(
  raw: AliyunOcrConfig | undefined,
  env: NodeJS.ProcessEnv,
): NonNullable<ResolvedOcrProviderConfig['aliyun']> {
  const accessKeyId = raw?.accessKeyId ?? env.FILECRYSTAL_ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = raw?.accessKeySecret ?? env.FILECRYSTAL_ALIYUN_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new FileParserError(
      ErrorCode.CONFIG_INVALID,
      'aliyun-ocr requires FILECRYSTAL_ALIYUN_ACCESS_KEY_ID and FILECRYSTAL_ALIYUN_ACCESS_KEY_SECRET',
    );
  }
  return {
    accessKeyId,
    accessKeySecret,
    endpoint: stripProtocol(raw?.endpoint ?? env.FILECRYSTAL_ALIYUN_OCR_ENDPOINT ?? 'ocr-api.cn-hangzhou.aliyuncs.com'),
    regionId: raw?.regionId ?? env.FILECRYSTAL_ALIYUN_OCR_REGION ?? 'cn-hangzhou',
    model: raw?.model ?? 'RecognizeAdvanced',
    outputTable: raw?.outputTable ?? true,
    row: raw?.row,
    paragraph: raw?.paragraph,
  };
}
