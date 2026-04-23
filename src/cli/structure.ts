import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createFileParser } from '../parser.js';
import {
  createStructuredExtractor,
  toStructureSource,
  type StructureSource,
} from '../structure.js';
import { buildConfig, writeJson, type CommonOptions } from './shared.js';
import type { ParseResult } from '../types.js';

interface StructureOpts extends CommonOptions {
  prompt?: string;
  promptText?: string;
  maxInputChars?: string;
  concurrency?: string;
  fullPages?: boolean;
  detectSeals?: boolean;
}

function looksLikeParsedJson(path: string): boolean {
  return extname(path).toLowerCase() === '.json';
}

function looksLikeMarkdown(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.md' || ext === '.markdown' || ext === '.txt';
}

export function registerStructureCommand(program: Command): void {
  program
    .command('structure')
    .description(
      'Extract structured fields from parsed JSON or raw files. Auto-parses raw files first. ' +
        'Combines multiple inputs into one LLM call; splits into batches when too large.',
    )
    .argument(
      '<inputs...>',
      'one or more `.parsed.json` (from earlier extract runs that saved JSON) or raw file paths',
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
      'text model. Examples: qwen-plus | qwen-max | qwen3-plus. Env: FILECRYSTAL_TEXT_MODEL. Default: qwen-plus',
    )
    .option(
      '--vision-model <model>',
      'vision model used when raw files need OCR first. Env: FILECRYSTAL_VISION_MODEL. Default: qwen-vl-ocr-latest',
    )
    .option(
      '--max-input-chars <n>',
      'split into batches when merged fullText exceeds this (default 80000)',
    )
    .option('--concurrency <n>', 'parallel raw parses when raw files are given', '3')
    .option('--full-pages', 'when parsing raw files first, disable truncation')
    .option('--no-detect-seals', 'when parsing raw files first, skip seal/signature detection')
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
      const parser = createFileParser(cfg);
      const parseOptions: Parameters<typeof parser.parse>[1] = {};
      if (opts.fullPages) parseOptions.fullPages = true;
      if (opts.detectSeals === false) parseOptions.detectSeals = false;

      const sources: StructureSource[] = [];
      const inputsMeta: Array<{ path: string; kind: 'parsed-json' | 'markdown' | 'raw-file' }> = [];

      for (const input of inputs) {
        if (looksLikeParsedJson(input)) {
          try {
            const body = await readFile(input, 'utf8');
            const parsed = JSON.parse(body) as ParseResult;
            if (parsed?.raw && parsed?.source) {
              sources.push(toStructureSource(parsed));
              inputsMeta.push({ path: input, kind: 'parsed-json' });
              continue;
            }
          } catch {
            // fall through — treat as raw file
          }
        }
        if (looksLikeMarkdown(input)) {
          // Treat .md / .markdown / .txt as a pre-extracted document: wrap
          // the file contents as ParsedRaw.fullText so the LLM sees the same
          // body the prompt author would see from the `extract` command.
          const body = await readFile(input, 'utf8');
          sources.push({ name: basename(input), raw: { fullText: body } });
          inputsMeta.push({ path: input, kind: 'markdown' });
          continue;
        }
        const result = await parser.parse(input, parseOptions);
        sources.push(toStructureSource(result));
        inputsMeta.push({ path: input, kind: 'raw-file' });
      }

      const extractor = createStructuredExtractor(cfg);
      const structureOpts: Parameters<typeof extractor.extract>[1] = {};
      if (promptContent) structureOpts.prompt = promptContent;
      if (opts.maxInputChars) structureOpts.maxInputChars = Number(opts.maxInputChars);

      const result = await extractor.extract(sources, structureOpts);

      writeJson({
        inputs: inputsMeta,
        promptName: result.promptName ?? (promptContent ? 'custom' : 'default-structure'),
        batches: result.batches,
        totalLlmMs: result.totalLlmMs,
        tokenUsage: result.tokenUsage,
        warnings: result.warnings,
        extracted: result.extracted,
      });
    });
}
