import OpenAI from 'openai';
import type { ExtractedField } from '../types.js';
import type { LlmBackend, LlmExtractRequest, LlmExtractResult } from './backend.js';
import { retry } from '../utils/concurrency.js';
import { FileParserError, ErrorCode } from '../utils/errors.js';

export interface OpenAICompatLlmOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  retries?: number;
}

export function createOpenAICompatLlmBackend(opts: OpenAICompatLlmOptions): LlmBackend {
  const client = new OpenAI({
    baseURL: opts.baseUrl,
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 60_000,
  });
  const retries = opts.retries ?? 2;

  return {
    async extract(req: LlmExtractRequest): Promise<LlmExtractResult> {
      const start = Date.now();
      const model = req.model ?? opts.model;
      const completion = await retry(
        () =>
          client.chat.completions.create(
            {
              model,
              messages: [
                { role: 'system', content: req.systemPrompt },
                { role: 'user', content: req.userPrompt },
              ],
              temperature: req.temperature ?? 0.1,
              response_format:
                req.responseFormatJson === false ? undefined : { type: 'json_object' },
            },
            req.signal ? { signal: req.signal } : undefined,
          ),
        { retries },
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new FileParserError(ErrorCode.LLM_JSON_PARSE, 'LLM returned empty content', {
          model,
        });
      }

      let parsed: Record<string, ExtractedField>;
      try {
        parsed = JSON.parse(content) as Record<string, ExtractedField>;
      } catch (err) {
        throw new FileParserError(ErrorCode.LLM_JSON_PARSE, 'LLM JSON parse failed', {
          cause: String(err),
          snippet: content.slice(0, 200),
        });
      }

      return {
        fields: parsed,
        usage: {
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
        },
        model,
        ms: Date.now() - start,
      };
    },
  };
}
