import type { ExtractedField } from '../types.js';

export interface LlmExtractRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  responseFormatJson?: boolean;
  signal?: AbortSignal;
}

export interface LlmExtractResult {
  fields: Record<string, ExtractedField>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
  model: string;
  ms: number;
}

export interface LlmBackend {
  extract(req: LlmExtractRequest): Promise<LlmExtractResult>;
}
