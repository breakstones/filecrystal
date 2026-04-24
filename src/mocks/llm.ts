import type { ExtractedField } from '../types.js';
import type { LlmBackend, LlmExtractRequest, LlmExtractResult } from '../llm/backend.js';

export interface MockLlmBackend extends LlmBackend {
  /** The most recent request seen when `record: true` was set; otherwise `undefined`. */
  readonly lastRequest: LlmExtractRequest | undefined;
  /** Every request seen in arrival order when `record: true`. */
  readonly requests: readonly LlmExtractRequest[];
}

export function createMockLlmBackend(opts: { record?: boolean } = {}): MockLlmBackend {
  const record = opts.record ?? false;
  const requests: LlmExtractRequest[] = [];
  return {
    async extract(req: LlmExtractRequest): Promise<LlmExtractResult> {
      if (record) requests.push(req);
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
    get lastRequest() {
      return record ? requests[requests.length - 1] : undefined;
    },
    get requests() {
      return requests;
    },
  };
}
