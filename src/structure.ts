import type { FileParserConfig, ParsedRaw, ParseResult } from './types.js';
import { resolveConfig } from './config.js';
import type { LlmBackend } from './llm/backend.js';
import { createOpenAICompatLlmBackend } from './llm/openai-compat.js';
import { createMockLlmBackend } from './mocks/llm.js';
import { parsePromptFile, buildUserPrompt } from './llm/prompt.js';
import { DEFAULT_STRUCTURE_PROMPT } from './prompts/default-structure.js';
import { toMarkdown } from './markdown.js';

/**
 * A single document payload fed to {@link StructuredExtractor.extract}.
 * `name` is used to prefix the text with `# File: <name>` inside the user
 * prompt so the model can attribute fields back to their source. `text` is
 * already-formatted Markdown — the structure stage never inspects its
 * internal shape.
 */
export interface StructureSource {
  name: string;
  text: string;
}

export interface StructureOptions {
  /** Markdown + frontmatter prompt content. Omit to use the built-in default. */
  prompt?: string;
  /**
   * Soft cap on combined text characters per LLM call. When the combined
   * input exceeds this value, sources are split across multiple LLM calls
   * and their per-field results are shallow-merged (later batch overrides
   * if both contain the same top-level key).
   *
   * Default: 500_000 — high enough that typical multi-document inputs fit
   * in a single call; explicit smaller values opt in to batching.
   */
  maxInputChars?: number;
  signal?: AbortSignal;
}

export interface StructureBatchStat {
  sources: number;
  chars: number;
  llmMs: number;
  promptTokens: number;
  completionTokens: number;
  /** True when this batch's JSON could not be parsed; the model's raw text is under `text`. */
  parseFailed?: boolean;
}

export interface StructureResult {
  /**
   * The merged result of every batch's LLM call, preserving the JSON shape
   * that the prompt asked for. Arbitrary keys — the caller (i.e. the prompt
   * author) owns the schema. When the model's response could not be parsed
   * as JSON even after best-effort repair, this will contain `{ text: ... }`
   * instead.
   */
  extracted: Record<string, unknown>;
  warnings: string[];
  batches: StructureBatchStat[];
  totalLlmMs: number;
  tokenUsage: { prompt: number; completion: number };
  promptName?: string;
}

export interface StructuredExtractor {
  extract(sources: StructureSource[], options?: StructureOptions): Promise<StructureResult>;
}

/**
 * Optional constructor overrides — primarily for unit tests that want to
 * intercept the LLM request without running the full mock/api code path.
 */
export interface StructuredExtractorOverrides {
  llm?: LlmBackend;
}

const DEFAULT_MAX_CHARS = 500_000;

export function createStructuredExtractor(
  config: FileParserConfig,
  overrides: StructuredExtractorOverrides = {},
): StructuredExtractor {
  const cfg = resolveConfig(config);
  const llm: LlmBackend =
    overrides.llm ??
    (cfg.mode === 'mock' || !cfg.openai
      ? createMockLlmBackend()
      : createOpenAICompatLlmBackend({
          baseUrl: cfg.openai.baseUrl,
          apiKey: cfg.openai.apiKey,
          model: cfg.openai.models.text,
          timeoutMs: cfg.extraction.timeoutMs,
        }));

  return {
    async extract(sources: StructureSource[], opts: StructureOptions = {}) {
      const promptContent = opts.prompt ?? DEFAULT_STRUCTURE_PROMPT;
      const { frontmatter, body } = parsePromptFile(promptContent);
      const maxChars = opts.maxInputChars ?? DEFAULT_MAX_CHARS;

      const batches = packIntoBatches(sources, maxChars);
      const warnings: string[] = [];

      // Resolve `enable_thinking` explicitly on every request: prompt
      // frontmatter wins when set, otherwise the env-level default
      // (`cfg.extraction.enableThinking`, false unless opted in). We always
      // forward the boolean — silently omitting the field would make qwen3
      // models fall back to their server-side default of `true`, which
      // would break our "thinking off by default" contract.
      const enableThinking = frontmatter.thinking ?? cfg.extraction.enableThinking;

      const perBatch = await Promise.all(
        batches.map(async (batch) => {
          const joined = joinSources(batch);
          const userPrompt = buildUserPrompt(body, joined);
          const chars = userPrompt.length;
          const res = await llm.extract({
            systemPrompt: body,
            userPrompt,
            ...(frontmatter.model ? { model: frontmatter.model } : {}),
            extraBody: { enable_thinking: enableThinking },
            temperature: frontmatter.temperature ?? cfg.extraction.defaultTemperature,
          });
          return { batch, chars, res };
        }),
      );

      const stats: StructureBatchStat[] = [];
      const merged: Record<string, unknown> = {};
      let totalLlmMs = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      for (const { batch, chars, res } of perBatch) {
        const stat: StructureBatchStat = {
          sources: batch.length,
          chars,
          llmMs: res.ms,
          promptTokens: res.usage?.promptTokens ?? 0,
          completionTokens: res.usage?.completionTokens ?? 0,
        };
        if (res.parseFailed) stat.parseFailed = true;
        stats.push(stat);
        totalLlmMs += res.ms;
        totalPromptTokens += res.usage?.promptTokens ?? 0;
        totalCompletionTokens += res.usage?.completionTokens ?? 0;

        // Shallow merge: later batch overrides earlier for same top-level key.
        // The prompt author is expected to handle multi-source semantics
        // themselves (the joined text carries `# File: <name>` headings per
        // source).
        for (const [k, v] of Object.entries(res.fields)) {
          merged[k] = v;
        }
      }

      if (batches.length > 1) {
        warnings.push(`input split into ${batches.length} batches (maxInputChars=${maxChars})`);
      }
      if (perBatch.some((b) => b.res.parseFailed)) {
        warnings.push('at least one batch returned non-JSON content; see `extracted.text`');
      }

      const out: StructureResult = {
        extracted: merged,
        warnings,
        batches: stats,
        totalLlmMs,
        tokenUsage: { prompt: totalPromptTokens, completion: totalCompletionTokens },
      };
      if (frontmatter.name) out.promptName = frontmatter.name;
      return out;
    },
  };
}

/**
 * Convenience: convert any {@link ParseResult} into a {@link StructureSource}
 * by rendering its raw data through {@link toMarkdown}. The structure stage
 * never sees `ParsedRaw` directly; every input becomes Markdown text first.
 */
export function toStructureSource(
  result: ParseResult | { raw: ParsedRaw; name?: string },
): StructureSource {
  if ('source' in result) {
    return { name: result.source.fileName, text: toMarkdown(result) };
  }
  return { name: result.name ?? 'document', text: toMarkdown({ raw: result.raw }) };
}

function joinSources(batch: StructureSource[]): string {
  return batch.map((s) => `# File: ${s.name}\n\n${s.text}`).join('\n\n---\n\n');
}

function packIntoBatches(sources: StructureSource[], maxChars: number): StructureSource[][] {
  if (sources.length === 0) return [[]];
  const batches: StructureSource[][] = [];
  let current: StructureSource[] = [];
  let currentChars = 0;

  for (const s of sources) {
    const len = s.text.length;
    if (currentChars + len > maxChars && current.length > 0) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(s);
    currentChars += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
