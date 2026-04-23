export interface LlmExtractRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  responseFormatJson?: boolean;
  /**
   * Per-call extra body fields merged over the backend-level `extraBody`.
   * A request-level key overrides the same backend-level key (so e.g. a
   * prompt frontmatter with `thinking: false` can override an env-level
   * default of `enable_thinking: true`).
   */
  extraBody?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * The result of an LLM extraction call.
 *
 * `fields` is whatever JSON shape the prompt asked the model to produce — we
 * pass it through verbatim so the caller's prompt owns the schema. When the
 * model's raw output cannot be parsed as JSON even after best-effort repair,
 * we fall back to `{ text: "<raw model output>" }` so the caller still gets
 * usable content.
 */
export interface LlmExtractResult {
  fields: Record<string, unknown>;
  /** True when we fell back to `{ text }` because JSON parsing failed. */
  parseFailed?: boolean;
  /** The raw string returned by the model, always available for debugging. */
  rawContent?: string;
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
