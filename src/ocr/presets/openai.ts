import type { OcrBackend } from '../backend.js';
import { createOpenAICompatOcrBackend } from '../openai-compat.js';

export interface OpenAIOcrPresetOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  retries?: number;
}

export function createOpenAIOcrBackend(opts: OpenAIOcrPresetOptions): OcrBackend {
  return createOpenAICompatOcrBackend({
    baseUrl: opts.baseUrl ?? 'https://api.openai.com/v1',
    apiKey: opts.apiKey,
    model: opts.model ?? 'gpt-4o',
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
  });
}
