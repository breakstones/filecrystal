import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { resolveConfig, QWEN_DEFAULT_BASE_URL } from '../../src/config.js';
import { FileParserError } from '../../src/utils/errors.js';

const ENV_KEYS = [
  'FILECRYSTAL_MODEL_BASE_URL',
  'FILECRYSTAL_MODEL_API_KEY',
  'FILECRYSTAL_VISION_MODEL',
  'FILECRYSTAL_TEXT_MODEL',
  'FILECRYSTAL_VISION_MODEL_THINKING',
  'FILECRYSTAL_TEXT_MODEL_THINKING',
  'FILECRYSTAL_CACHE_DIR',
  'FILECRYSTAL_OCR_CONCURRENCY',
  'FILECRYSTAL_OCR_PROVIDER',
  'FILECRYSTAL_ALIYUN_ACCESS_KEY_ID',
  'FILECRYSTAL_ALIYUN_ACCESS_KEY_SECRET',
  'FILECRYSTAL_ALIYUN_OCR_ENDPOINT',
  'FILECRYSTAL_ALIYUN_OCR_REGION',
] as const;

describe('resolveConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts mock mode without credentials', () => {
    const cfg = resolveConfig({ mode: 'mock' });
    expect(cfg.mode).toBe('mock');
    expect(cfg.openai).toBeUndefined();
    expect(cfg.ocr.maxConcurrency).toBe(24);
  });

  it('FILECRYSTAL_OCR_CONCURRENCY overrides the default pool size', () => {
    process.env.FILECRYSTAL_OCR_CONCURRENCY = '48';
    const cfg = resolveConfig({ mode: 'mock' });
    expect(cfg.ocr.maxConcurrency).toBe(48);
  });

  it('explicit config.ocr.maxConcurrency wins over FILECRYSTAL_OCR_CONCURRENCY', () => {
    process.env.FILECRYSTAL_OCR_CONCURRENCY = '48';
    const cfg = resolveConfig({ mode: 'mock', ocr: { maxConcurrency: 6 } });
    expect(cfg.ocr.maxConcurrency).toBe(6);
  });

  it('ignores invalid FILECRYSTAL_OCR_CONCURRENCY values', () => {
    for (const bad of ['0', '-1', 'abc', '']) {
      process.env.FILECRYSTAL_OCR_CONCURRENCY = bad;
      const cfg = resolveConfig({ mode: 'mock' });
      expect(cfg.ocr.maxConcurrency).toBe(24);
    }
  });

  it('throws when api mode lacks credentials', () => {
    expect(() => resolveConfig({ mode: 'api' })).toThrow(FileParserError);
  });

  it('reads FILECRYSTAL_MODEL_BASE_URL + FILECRYSTAL_MODEL_API_KEY', () => {
    process.env.FILECRYSTAL_MODEL_BASE_URL = 'https://example.com/v1';
    process.env.FILECRYSTAL_MODEL_API_KEY = 'sk-new';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.openai?.baseUrl).toBe('https://example.com/v1');
    expect(cfg.openai?.apiKey).toBe('sk-new');
    expect(cfg.openai?.models.ocr).toBe('qwen-vl-ocr-latest');
    expect(cfg.openai?.models.text).toBe('qwen3.6-plus');
  });

  it('FILECRYSTAL_VISION_MODEL drives both ocr and vision slots', () => {
    process.env.FILECRYSTAL_MODEL_BASE_URL = 'https://x/v1';
    process.env.FILECRYSTAL_MODEL_API_KEY = 'k';
    process.env.FILECRYSTAL_VISION_MODEL = 'qwen3-vl-plus';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.openai?.models.ocr).toBe('qwen3-vl-plus');
    expect(cfg.openai?.models.vision).toBe('qwen3-vl-plus');
  });

  it('FILECRYSTAL_TEXT_MODEL overrides text model', () => {
    process.env.FILECRYSTAL_MODEL_BASE_URL = 'https://x/v1';
    process.env.FILECRYSTAL_MODEL_API_KEY = 'k';
    process.env.FILECRYSTAL_TEXT_MODEL = 'qwen-max';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.openai?.models.text).toBe('qwen-max');
  });

  it('FILECRYSTAL_VISION_MODEL_THINKING enables only ocr.enableThinking', () => {
    process.env.FILECRYSTAL_MODEL_BASE_URL = 'https://x/v1';
    process.env.FILECRYSTAL_MODEL_API_KEY = 'k';
    process.env.FILECRYSTAL_VISION_MODEL_THINKING = 'true';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.ocr.enableThinking).toBe(true);
    expect(cfg.extraction.enableThinking).toBe(false);
  });

  it('FILECRYSTAL_TEXT_MODEL_THINKING enables only extraction.enableThinking', () => {
    process.env.FILECRYSTAL_MODEL_BASE_URL = 'https://x/v1';
    process.env.FILECRYSTAL_MODEL_API_KEY = 'k';
    process.env.FILECRYSTAL_TEXT_MODEL_THINKING = 'true';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.ocr.enableThinking).toBe(false);
    expect(cfg.extraction.enableThinking).toBe(true);
  });

  it('thinking switches are independent — both can be on', () => {
    process.env.FILECRYSTAL_MODEL_BASE_URL = 'https://x/v1';
    process.env.FILECRYSTAL_MODEL_API_KEY = 'k';
    process.env.FILECRYSTAL_VISION_MODEL_THINKING = 'true';
    process.env.FILECRYSTAL_TEXT_MODEL_THINKING = 'true';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.ocr.enableThinking).toBe(true);
    expect(cfg.extraction.enableThinking).toBe(true);
  });

  it('thinking switches default to false', () => {
    process.env.FILECRYSTAL_MODEL_BASE_URL = 'https://x/v1';
    process.env.FILECRYSTAL_MODEL_API_KEY = 'k';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.ocr.enableThinking).toBe(false);
    expect(cfg.extraction.enableThinking).toBe(false);
  });

  it('honours explicit openai config over env', () => {
    process.env.FILECRYSTAL_MODEL_API_KEY = 'env-key';
    const cfg = resolveConfig({
      mode: 'api',
      openai: {
        baseUrl: QWEN_DEFAULT_BASE_URL,
        apiKey: 'explicit-key',
        models: { ocr: 'my-ocr', text: 'my-text' },
      },
    });
    expect(cfg.openai?.apiKey).toBe('explicit-key');
    expect(cfg.openai?.models.ocr).toBe('my-ocr');
    expect(cfg.openai?.models.text).toBe('my-text');
  });

  it('rejects invalid config shape', () => {
    // @ts-expect-error intentional bad input
    expect(() => resolveConfig({ mode: 'nope' })).toThrow(FileParserError);
  });

  it('resolves aliyun-ocr provider from environment without requiring OpenAI credentials', () => {
    process.env.FILECRYSTAL_OCR_PROVIDER = 'aliyun-ocr';
    process.env.FILECRYSTAL_ALIYUN_ACCESS_KEY_ID = 'ak-id';
    process.env.FILECRYSTAL_ALIYUN_ACCESS_KEY_SECRET = 'ak-secret';
    process.env.FILECRYSTAL_ALIYUN_OCR_REGION = 'cn-hangzhou';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.ocr.provider).toBe('aliyun-ocr');
    expect(cfg.ocr.primary.provider).toBe('aliyun-ocr');
    expect(cfg.ocr.primary.model).toBe('RecognizeAdvanced');
    expect(cfg.ocr.primary.aliyun?.accessKeyId).toBe('ak-id');
    expect(cfg.ocr.primary.aliyun?.accessKeySecret).toBe('ak-secret');
    expect(cfg.ocr.primary.aliyun?.regionId).toBe('cn-hangzhou');
  });

  it('enables Aliyun table output by default without row or paragraph structure', () => {
    process.env.FILECRYSTAL_OCR_PROVIDER = 'aliyun-ocr';
    process.env.FILECRYSTAL_ALIYUN_ACCESS_KEY_ID = 'ak-id';
    process.env.FILECRYSTAL_ALIYUN_ACCESS_KEY_SECRET = 'ak-secret';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.ocr.primary.aliyun?.outputTable).toBe(true);
    expect(cfg.ocr.primary.aliyun?.row).toBeUndefined();
    expect(cfg.ocr.primary.aliyun?.paragraph).toBeUndefined();
  });

  it('explicit aliyun OCR config wins over environment', () => {
    process.env.FILECRYSTAL_OCR_PROVIDER = 'aliyun-ocr';
    process.env.FILECRYSTAL_ALIYUN_ACCESS_KEY_ID = 'env-id';
    process.env.FILECRYSTAL_ALIYUN_ACCESS_KEY_SECRET = 'env-secret';
    const cfg = resolveConfig({
      mode: 'api',
      ocr: {
        provider: 'aliyun-ocr',
        aliyun: {
          accessKeyId: 'explicit-id',
          accessKeySecret: 'explicit-secret',
          endpoint: 'https://ocr.example.com',
          outputTable: true,
          row: true,
          paragraph: true,
        },
      },
    });
    expect(cfg.ocr.primary.aliyun?.accessKeyId).toBe('explicit-id');
    expect(cfg.ocr.primary.aliyun?.accessKeySecret).toBe('explicit-secret');
    expect(cfg.ocr.primary.aliyun?.endpoint).toBe('ocr.example.com');
    expect(cfg.ocr.primary.aliyun?.outputTable).toBe(true);
    expect(cfg.ocr.primary.aliyun?.row).toBe(true);
    expect(cfg.ocr.primary.aliyun?.paragraph).toBe(true);
  });

  it('aliyun-ocr requires credentials without leaking secret values', () => {
    process.env.FILECRYSTAL_OCR_PROVIDER = 'aliyun-ocr';
    process.env.FILECRYSTAL_ALIYUN_ACCESS_KEY_SECRET = 'super-secret-value';
    expect(() => resolveConfig({ mode: 'api' })).toThrow(FileParserError);
    try {
      resolveConfig({ mode: 'api' });
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('super-secret-value');
    }
  });
});
