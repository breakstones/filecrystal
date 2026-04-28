import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createFileParser } from '../parser.js';
import { parseMany, type ParseManyItem } from '../batch.js';
import { toMarkdown } from '../markdown.js';
import { classifyInputs } from '../utils/archive.js';
import { createStructuredExtractor, type StructureSource } from '../structure.js';
import { buildConfig, resolveFileConcurrency, writeJson, type CommonOptions } from './shared.js';
import type { ParseOptions } from '../types.js';

interface StructureOpts extends CommonOptions {
  prompt?: string;
  promptText?: string;
  maxInputChars?: string;
  concurrency?: string;
  fullPages?: boolean;
  detectSeals?: boolean;
}

interface InputMeta {
  path: string;
  kind: 'parsed' | 'passthrough';
}

interface ParseFailure {
  path: string;
  error: string;
  code?: string;
}

export function registerStructureCommand(program: Command): void {
  program
    .command('structure')
    .description(
      'Extract structured fields from text and raw files. Text inputs (md/markdown/txt) ' +
        'pass through; raw files (pdf/xlsx/docx/image/zip) are auto-extracted to Markdown first. ' +
        'All inputs are concatenated in input order and sent to the LLM in a single call by default; ' +
        'batching only triggers when --max-input-chars is set below the combined text length.',
    )
    .argument(
      '<inputs...>',
      'one or more file paths: raw files (pdf/jpg/png/xlsx/xls/docx/doc), text files (md/markdown/txt), or zip archives',
    )
    .option(
      '--prompt <file>',
      'path to a prompt file (Markdown + YAML frontmatter). Mutually exclusive with --prompt-text.',
    )
    .option(
      '--prompt-text <text>',
      'prompt body as a literal string (Markdown + frontmatter allowed). Mutually exclusive with --prompt.',
    )
    .option('--base-url <url>', 'OpenAI-compatible base URL (env: FILECRYSTAL_MODEL_BASE_URL)')
    .option('--api-key <key>', 'OpenAI-compatible API key (env: FILECRYSTAL_MODEL_API_KEY)')
    .option(
      '--text-model <model>',
      'text model. Examples: qwen3.6-plus | qwen-plus | qwen-max | qwen3-plus. Env: FILECRYSTAL_TEXT_MODEL. Default: qwen3.6-plus',
    )
    .option(
      '--vision-model <model>',
      'vision model used when raw files need OCR first. Env: FILECRYSTAL_VISION_MODEL. Default: qwen-vl-ocr-latest',
    )
    .option('--ocr-provider <provider>', 'OCR provider for raw-file extraction: openai-compat | aliyun-ocr. Env: FILECRYSTAL_OCR_PROVIDER')
    .option('--aliyun-access-key-id <id>', 'Aliyun OCR AccessKeyId. Prefer env: FILECRYSTAL_ALIYUN_ACCESS_KEY_ID')
    .option('--aliyun-access-key-secret <secret>', 'Aliyun OCR AccessKeySecret. Prefer env: FILECRYSTAL_ALIYUN_ACCESS_KEY_SECRET')
    .option('--aliyun-ocr-endpoint <url>', 'Aliyun OCR endpoint. Env: FILECRYSTAL_ALIYUN_OCR_ENDPOINT')
    .option('--aliyun-ocr-region <region>', 'Aliyun OCR region. Env: FILECRYSTAL_ALIYUN_OCR_REGION')
    .option(
      '--max-input-chars <n>',
      'force batch split when combined text exceeds this many characters (default 500000 — single LLM call covers most inputs)',
    )
    .option(
      '--concurrency <n>',
      'parallel raw-file extractions when raw files are given. Env: FILECRYSTAL_FILE_CONCURRENCY. Default: min(<raw files>, 20).',
    )
    .option('--full-pages', 'when extracting raw files first, disable truncation')
    .option('--no-detect-seals', 'when extracting raw files first, skip seal/signature detection')
    .action(async (inputs: string[], opts: StructureOpts) => {
      if (opts.prompt && opts.promptText) {
        throw new Error('--prompt and --prompt-text are mutually exclusive');
      }
      const promptContent = opts.promptText
        ? opts.promptText
        : opts.prompt
          ? await readFile(opts.prompt, 'utf8')
          : undefined;

      const cfg = buildConfig(opts);
      const classified = await classifyInputs(inputs);

      const parser = createFileParser(cfg);
      const parseOptions: ParseOptions = {};
      if (opts.fullPages) parseOptions.fullPages = true;
      if (opts.detectSeals === false) parseOptions.detectSeals = false;

      const concurrency = opts.concurrency
        ? Math.max(1, Number(opts.concurrency) || 1)
        : resolveFileConcurrency(classified.parseInputs.length);

      const batch =
        classified.parseInputs.length > 0
          ? await parseMany(parser, classified.parseInputs, {
              concurrency,
              parse: parseOptions,
            })
          : { items: [] as ParseManyItem[] };

      const textByPath = new Map<string, string>();
      const parseFailures: ParseFailure[] = [];
      for (const item of batch.items) {
        if (item.ok && item.result) {
          textByPath.set(item.path, toMarkdown(item.result));
        } else {
          const failure: ParseFailure = {
            path: item.path,
            error: item.error ?? 'parse failed',
          };
          if (item.code) failure.code = item.code;
          parseFailures.push(failure);
        }
      }
      for (const p of classified.passthroughInputs) {
        textByPath.set(p, await readFile(p, 'utf8'));
      }

      const sources: StructureSource[] = [];
      const inputsMeta: InputMeta[] = [];
      for (const slot of classified.slots) {
        if (slot.kind === 'archive-failed') {
          const failure: ParseFailure = {
            path: slot.path,
            error: slot.error ?? 'archive expansion failed',
          };
          if (slot.code) failure.code = slot.code;
          parseFailures.push(failure);
          continue;
        }
        const text = textByPath.get(slot.path);
        if (text === undefined) continue;
        sources.push({ name: basename(slot.path), text });
        inputsMeta.push({
          path: slot.path,
          kind: slot.kind === 'passthrough' ? 'passthrough' : 'parsed',
        });
      }

      const extractor = createStructuredExtractor(cfg);
      const structureOpts: Parameters<typeof extractor.extract>[1] = {};
      if (promptContent) structureOpts.prompt = promptContent;
      if (opts.maxInputChars) structureOpts.maxInputChars = Number(opts.maxInputChars);

      const result = await extractor.extract(sources, structureOpts);

      const summary: Record<string, unknown> = {
        inputs: inputsMeta,
        promptName: result.promptName ?? (promptContent ? 'custom' : 'default-structure'),
        batches: result.batches,
        totalLlmMs: result.totalLlmMs,
        tokenUsage: result.tokenUsage,
        warnings: result.warnings,
        extracted: result.extracted,
      };
      if (classified.archives.length > 0) summary.archives = classified.archives;
      if (parseFailures.length > 0) summary.parseFailures = parseFailures;

      writeJson(summary);

      if (parseFailures.length > 0) process.exitCode = 3;
    });
}
