import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { resolveConfig, QWEN_DEFAULT_BASE_URL } from '../../src/config.js';
import { FileParserError } from '../../src/utils/errors.js';

describe('resolveConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FILECRYSTAL_BASE_URL;
    delete process.env.FILECRYSTAL_API_KEY;
    delete process.env.FILECRYSTAL_OCR_MODEL;
    delete process.env.FILECRYSTAL_VISION_MODEL;
    delete process.env.FILECRYSTAL_TEXT_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts mock mode without credentials', () => {
    const cfg = resolveConfig({ mode: 'mock' });
    expect(cfg.mode).toBe('mock');
    expect(cfg.openai).toBeUndefined();
    expect(cfg.ocr.maxConcurrency).toBe(3);
  });

  it('throws when api mode lacks credentials', () => {
    expect(() => resolveConfig({ mode: 'api' })).toThrow(FileParserError);
  });

  it('merges env vars for api mode', () => {
    process.env.FILECRYSTAL_BASE_URL = 'https://example.com/v1';
    process.env.FILECRYSTAL_API_KEY = 'sk-test';
    const cfg = resolveConfig({ mode: 'api' });
    expect(cfg.openai?.baseUrl).toBe('https://example.com/v1');
    expect(cfg.openai?.apiKey).toBe('sk-test');
    expect(cfg.openai?.models.ocr).toBe('qwen-vl-ocr-latest');
    expect(cfg.openai?.models.text).toBe('qwen-plus');
  });

  it('honours explicit openai config over env', () => {
    process.env.FILECRYSTAL_API_KEY = 'env-key';
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
