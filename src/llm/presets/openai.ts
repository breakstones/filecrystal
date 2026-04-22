import type { LlmBackend } from '../backend.js';
import { createOpenAICompatLlmBackend } from '../openai-compat.js';

export interface OpenAILlmPresetOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  retries?: number;
}

export function createOpenAILlmBackend(opts: OpenAILlmPresetOptions): LlmBackend {
  return createOpenAICompatLlmBackend({
    baseUrl: opts.baseUrl ?? 'https://api.openai.com/v1',
    apiKey: opts.apiKey,
    model: opts.model ?? 'gpt-4o-mini',
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
  });
}
