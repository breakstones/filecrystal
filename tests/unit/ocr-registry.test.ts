import { describe, expect, it } from 'vitest';
import { createOcrBackend } from '../../src/ocr/registry.js';
import type { ResolvedConfig, ResolvedOcrProviderConfig } from '../../src/config.js';
import { FileParserError } from '../../src/utils/errors.js';

const baseOcrConfig: ResolvedConfig['ocr'] = {
  maxConcurrency: 1,
  timeoutMs: 1000,
  retries: 0,
  imageMaxLongEdge: 2000,
  enableThinking: false,
  provider: 'openai-compat',
  primary: {
    provider: 'openai-compat',
    model: 'm',
    openai: { baseUrl: 'https://example.com/v1', apiKey: 'k', model: 'm' },
  },
  vision: {
    provider: 'openai-compat',
    model: 'v',
    openai: { baseUrl: 'https://example.com/v1', apiKey: 'k', model: 'v' },
  },
};

describe('createOcrBackend', () => {
  it('creates openai-compatible backends', () => {
    const backend = createOcrBackend(baseOcrConfig.primary, baseOcrConfig);
    expect(typeof backend.recognize).toBe('function');
  });

  it('creates aliyun OCR backends', () => {
    const provider: ResolvedOcrProviderConfig = {
      provider: 'aliyun-ocr',
      model: 'RecognizeAdvanced',
      aliyun: {
        accessKeyId: 'ak-id',
        accessKeySecret: 'ak-secret',
        model: 'RecognizeAdvanced',
      },
    };
    const backend = createOcrBackend(provider, { ...baseOcrConfig, provider: 'aliyun-ocr' });
    expect(typeof backend.recognize).toBe('function');
  });

  it('throws a config error when provider endpoint config is missing', () => {
    expect(() =>
      createOcrBackend({ provider: 'aliyun-ocr', model: 'RecognizeAdvanced' }, baseOcrConfig),
    ).toThrow(FileParserError);
  });
});
