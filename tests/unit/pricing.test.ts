import { describe, expect, it } from 'vitest';
import { MODEL_PRICING, computeYuan } from '../../src/llm/pricing.js';

describe('MODEL_PRICING', () => {
  it('includes the required qwen models', () => {
    expect(MODEL_PRICING['qwen-plus']).toBeDefined();
    expect(MODEL_PRICING['qwen-vl-ocr-latest']).toBeDefined();
    expect(MODEL_PRICING['qwen-vl-max']).toBeDefined();
  });
});

describe('computeYuan', () => {
  it('returns zero for unknown models', () => {
    expect(computeYuan('unknown-model', { promptTokens: 1000 })).toBe(0);
  });

  it('computes CNY cost for qwen-plus', () => {
    const y = computeYuan('qwen-plus', { promptTokens: 1000, completionTokens: 500 });
    expect(y).toBeGreaterThan(0);
  });

  it('converts USD pricing to CNY for OpenAI models', () => {
    const y = computeYuan('gpt-4o', { promptTokens: 1000, completionTokens: 1000 });
    expect(y).toBeGreaterThan(0);
  });
});
