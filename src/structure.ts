import type {
  FileParserConfig,
  ParsedRaw,
  ParsedRawPage,
  ParsedRawSection,
  ParsedRawSheet,
  ParseResult,
} from './types.js';
import { resolveConfig } from './config.js';
import type { LlmBackend } from './llm/backend.js';
import { createOpenAICompatLlmBackend } from './llm/openai-compat.js';
import { createMockLlmBackend } from './mocks/llm.js';
import { parsePromptFile, buildUserPrompt } from './llm/prompt.js';
import { DEFAULT_STRUCTURE_PROMPT } from './prompts/default-structure.js';

/**
 * A single document payload fed to {@link StructuredExtractor.extract}.
 * Either pass a {@link ParsedRaw} directly, or a full {@link ParseResult}
 * (only its `source.fileName` and `raw` are used).
 */
export interface StructureSource {
  name?: string;
  raw: ParsedRaw;
}

export interface StructureOptions {
  /** Markdown + frontmatter prompt content. Omit to use the built-in default. */
  prompt?: string;
  /**
   * Soft cap on combined `fullText` characters per LLM call.
   * When the full batch would exceed it, sources are split across multiple
   * calls and the per-field results are merged (later batch overrides if
   * both contain the same top-level key).
   * Default: 80_000.
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

const DEFAULT_MAX_CHARS = 80_000;

export function createStructuredExtractor(config: FileParserConfig): StructuredExtractor {
  const cfg = resolveConfig(config);
  const llm: LlmBackend =
    cfg.mode === 'mock' || !cfg.openai
      ? createMockLlmBackend()
      : createOpenAICompatLlmBackend({
          baseUrl: cfg.openai.baseUrl,
          apiKey: cfg.openai.apiKey,
          model: cfg.openai.models.text,
          timeoutMs: cfg.extraction.timeoutMs,
          ...(cfg.extraction.enableThinking ? { extraBody: { enable_thinking: true } } : {}),
        });

  return {
    async extract(sources: StructureSource[], opts: StructureOptions = {}) {
      const promptContent = opts.prompt ?? DEFAULT_STRUCTURE_PROMPT;
      const { frontmatter, body } = parsePromptFile(promptContent);
      const maxChars = opts.maxInputChars ?? DEFAULT_MAX_CHARS;

      const batches = packIntoBatches(sources, maxChars);
      const warnings: string[] = [];

      // Run all batches in parallel — they're independent; final merge is
      // just an Object.assign on top-level keys, so order within an input
      // segment doesn't matter as long as we preserve input order across
      // batches (which we do by mapping over `batches` indices).
      // Prompt-level `thinking` opts a single prompt into / out of
      // provider reasoning (e.g. Qwen3 `enable_thinking`), overriding the
      // env-level default.
      const perPromptExtraBody =
        frontmatter.thinking !== undefined
          ? { enable_thinking: frontmatter.thinking }
          : undefined;

      const perBatch = await Promise.all(
        batches.map(async (batch) => {
          const mergedRaw = mergeRawBatch(batch);
          const userPrompt = buildUserPrompt(body, mergedRaw);
          const chars = userPrompt.length;
          const res = await llm.extract({
            systemPrompt: body,
            userPrompt,
            ...(frontmatter.model ? { model: frontmatter.model } : {}),
            ...(perPromptExtraBody ? { extraBody: perPromptExtraBody } : {}),
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
        // themselves (the merged raw carries `【<name>】` tags per source).
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
 * Convenience: convert any {@link ParseResult} into a {@link StructureSource}.
 */
export function toStructureSource(
  result: ParseResult | { raw: ParsedRaw; name?: string },
): StructureSource {
  if ('source' in result) {
    return { name: result.source.fileName, raw: result.raw };
  }
  const source: StructureSource = { raw: result.raw };
  if (result.name !== undefined) source.name = result.name;
  return source;
}

function packIntoBatches(sources: StructureSource[], maxChars: number): StructureSource[][] {
  if (sources.length === 0) return [[]];
  const batches: StructureSource[][] = [];
  let current: StructureSource[] = [];
  let currentChars = 0;

  for (const s of sources) {
    const len = approxChars(s.raw);
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

function approxChars(raw: ParsedRaw): number {
  if (raw.fullText) return raw.fullText.length;
  const sheetChars = (raw.sheets ?? []).reduce(
    (s, sh) => s + sh.cells.reduce((c, cell) => c + String(cell.value ?? '').length + 10, 0),
    0,
  );
  const pageChars = (raw.pages ?? []).reduce((s, p) => s + (p.text?.length ?? 0), 0);
  const sectionChars = (raw.sections ?? []).reduce((s, sec) => s + (sec.text?.length ?? 0), 0);
  return sheetChars + pageChars + sectionChars;
}

function mergeRawBatch(batch: StructureSource[]): ParsedRaw {
  if (batch.length === 1) return batch[0]!.raw;

  const pages: ParsedRawPage[] = [];
  const sheets: ParsedRawSheet[] = [];
  const sections: ParsedRawSection[] = [];
  const textChunks: string[] = [];

  for (const src of batch) {
    const tag = src.name ? `【${src.name}】` : '【document】';
    if (src.raw.pages) pages.push(...src.raw.pages);
    if (src.raw.sheets) {
      for (const sh of src.raw.sheets) {
        sheets.push(src.name ? { ...sh, sheetName: `${src.name}::${sh.sheetName}` } : sh);
      }
    }
    if (src.raw.sections) {
      for (const sec of src.raw.sections) {
        sections.push(src.name ? { ...sec, sectionId: `${src.name}::${sec.sectionId}` } : sec);
      }
    }
    if (src.raw.fullText) textChunks.push(`${tag}\n${src.raw.fullText}`);
  }

  const merged: ParsedRaw = {};
  if (pages.length > 0) merged.pages = pages;
  if (sheets.length > 0) merged.sheets = sheets;
  if (sections.length > 0) merged.sections = sections;
  if (textChunks.length > 0) merged.fullText = textChunks.join('\n\n');
  return merged;
}
