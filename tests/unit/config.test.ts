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
    expect(cfg.ocr.maxConcurrency).toBe(18);
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
    expect(cfg.openai?.models.text).toBe('qwen-plus');
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
});
