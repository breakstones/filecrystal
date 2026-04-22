import type { ExtractedField } from '../types.js';
import type { LlmBackend, LlmExtractRequest, LlmExtractResult } from '../llm/backend.js';

export function createMockLlmBackend(): LlmBackend {
  return {
    async extract(_req: LlmExtractRequest): Promise<LlmExtractResult> {
      const fields: Record<string, ExtractedField> = {
        mockField: {
          value: '[mock]',
          confidence: 0.5,
          rawHint: 'mock',
        },
      };
      return {
        fields,
        model: 'mock-llm',
        ms: 1,
      };
    },
  };
}
