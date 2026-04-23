import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import type { LlmBackend, LlmExtractRequest, LlmExtractResult } from './backend.js';
import { retry } from '../utils/concurrency.js';
import { FileParserError, ErrorCode } from '../utils/errors.js';
import { parseJsonFixing } from '../utils/json-fix.js';

export interface OpenAICompatLlmOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  retries?: number;
  /**
   * Extra body fields forwarded verbatim to `chat.completions.create`. Used
   * for provider-specific switches — e.g. DashScope's `enable_thinking` for
   * Qwen3 reasoning models.
   */
  extraBody?: Record<string, unknown>;
}

export function createOpenAICompatLlmBackend(opts: OpenAICompatLlmOptions): LlmBackend {
  const client = new OpenAI({
    baseURL: opts.baseUrl,
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 60_000,
  });
  const retries = opts.retries ?? 2;
  const extraBody = opts.extraBody;

  return {
    async extract(req: LlmExtractRequest): Promise<LlmExtractResult> {
      const start = Date.now();
      const model = req.model ?? opts.model;
      const body = {
        model,
        messages: [
          { role: 'system' as const, content: req.systemPrompt },
          { role: 'user' as const, content: req.userPrompt },
        ],
        temperature: req.temperature ?? 0.1,
        response_format:
          req.responseFormatJson === false ? undefined : { type: 'json_object' as const },
        ...(extraBody ?? {}),
      };
      const completion = await retry(
        () =>
          client.chat.completions.create(
            body as unknown as Parameters<typeof client.chat.completions.create>[0],
            req.signal ? { signal: req.signal } : undefined,
          ) as Promise<ChatCompletion>,
        { retries },
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new FileParserError(ErrorCode.LLM_JSON_PARSE, 'LLM returned empty content', {
          model,
        });
      }

      // Pass the model's JSON through verbatim — the prompt owns the schema.
      // If repair can't make it valid JSON, fall back to `{ text: raw }` so
      // the caller still gets usable content without exceptions.
      let fields: Record<string, unknown>;
      let parseFailed = false;
      try {
        const parsed = parseJsonFixing(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          fields = parsed as Record<string, unknown>;
        } else {
          // Top-level was not an object (array or primitive) — wrap it so the
          // caller can still index into `fields`.
          fields = { result: parsed };
        }
      } catch {
        fields = { text: content };
        parseFailed = true;
      }

      return {
        fields,
        parseFailed,
        rawContent: content,
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
