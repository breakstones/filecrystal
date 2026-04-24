import type { LlmBackend } from '../backend.js';
import { createOpenAICompatLlmBackend } from '../openai-compat.js';
import { QWEN_DEFAULT_BASE_URL } from '../../config.js';

export interface QwenLlmPresetOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  retries?: number;
}

export function createQwenLlmBackend(opts: QwenLlmPresetOptions): LlmBackend {
  return createOpenAICompatLlmBackend({
    baseUrl: opts.baseUrl ?? QWEN_DEFAULT_BASE_URL,
    apiKey: opts.apiKey,
    model: opts.model ?? 'qwen3.6-plus',
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
  });
}
