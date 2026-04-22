import type { OcrBackend } from '../backend.js';
import { createOpenAICompatOcrBackend } from '../openai-compat.js';
import { QWEN_DEFAULT_BASE_URL } from '../../config.js';

export interface QwenOcrPresetOptions {
  apiKey: string;
  baseUrl?: string;
  ocrModel?: string;
  visionModel?: string;
  timeoutMs?: number;
  retries?: number;
}

export function createQwenOcrBackend(opts: QwenOcrPresetOptions): OcrBackend {
  return createOpenAICompatOcrBackend({
    baseUrl: opts.baseUrl ?? QWEN_DEFAULT_BASE_URL,
    apiKey: opts.apiKey,
    model: opts.ocrModel ?? 'qwen-vl-ocr-latest',
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
  });
}

export function createQwenVisionBackend(opts: QwenOcrPresetOptions): OcrBackend {
  return createOpenAICompatOcrBackend({
    baseUrl: opts.baseUrl ?? QWEN_DEFAULT_BASE_URL,
    apiKey: opts.apiKey,
    model: opts.visionModel ?? 'qwen-vl-max',
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
  });
}
