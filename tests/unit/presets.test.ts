import { describe, expect, it } from 'vitest';
import { createQwenOcrBackend, createQwenVisionBackend } from '../../src/ocr/presets/qwen.js';
import { createOpenAIOcrBackend } from '../../src/ocr/presets/openai.js';
import { createQwenLlmBackend } from '../../src/llm/presets/qwen.js';
import { createOpenAILlmBackend } from '../../src/llm/presets/openai.js';

describe('provider presets', () => {
  it('qwen OCR preset returns an OcrBackend', () => {
    const b = createQwenOcrBackend({ apiKey: 'k' });
    expect(typeof b.recognize).toBe('function');
  });

  it('qwen vision preset returns an OcrBackend', () => {
    const b = createQwenVisionBackend({ apiKey: 'k' });
    expect(typeof b.recognize).toBe('function');
  });

  it('openai OCR preset returns an OcrBackend', () => {
    const b = createOpenAIOcrBackend({ apiKey: 'k' });
    expect(typeof b.recognize).toBe('function');
  });

  it('qwen LLM preset returns an LlmBackend', () => {
    const b = createQwenLlmBackend({ apiKey: 'k' });
    expect(typeof b.extract).toBe('function');
  });

  it('openai LLM preset returns an LlmBackend', () => {
    const b = createOpenAILlmBackend({ apiKey: 'k' });
    expect(typeof b.extract).toBe('function');
  });
});
