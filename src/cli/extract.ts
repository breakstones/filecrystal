import { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { createFileParser } from '../parser.js';
import { parseMany, type ParseManyItem } from '../batch.js';
import { toMarkdown } from '../markdown.js';
import { classifyInputs, type InputSlot } from '../utils/archive.js';
import { buildConfig, writeJson, type CommonOptions } from './shared.js';

interface ExtractOpts extends CommonOptions {
  out?: string;
  concurrency?: string;
  fullPages?: boolean;
  force?: boolean;
  detectSeals?: boolean;
}

export type ExtractSummaryItem = {
  path: string;
  ok: boolean;
  durationMs: number;
  outFile?: string;
  error?: string;
  code?: string;
  message?: string;
};

export function registerExtractCommand(program: Command): void {
  program
    .command('extract')
    .description(
      'Parse files into Markdown. Multi-file + concurrent. Real OCR + seal detection. ' +
        '.zip inputs are expanded into a same-named sibling directory; ' +
        '.md / .markdown / .txt inputs are reported as already-text passthroughs.',
    )
    .argument(
      '<paths...>',
      'one or more file paths (pdf / jpg / png / xlsx / xls / docx / doc / zip / md / txt)',
    )
    .option(
      '--out <dir>',
      'output directory for `.md` files. Default: same directory as each input file.',
    )
    .option(
      '--concurrency <n>',
      'parallel file parses. Default: min(<files>, 10) so small batches finish as fast as possible.',
    )
    .option('--base-url <url>', 'OpenAI-compatible base URL (env: FILECRYSTAL_MODEL_BASE_URL)')
    .option('--api-key <key>', 'OpenAI-compatible API key (env: FILECRYSTAL_MODEL_API_KEY)')
    .option(
      '--vision-model <model>',
      'vision model (OCR + seal detection). Examples: qwen-vl-ocr-latest | qwen-vl-plus | qwen-vl-max | qwen3-vl-plus. Env: FILECRYSTAL_VISION_MODEL. Default: qwen-vl-ocr-latest',
    )
    .option('--full-pages', 'disable head-tail truncation for long PDF/docx')
    .option('--force', 'skip cache')
    .option('--no-detect-seals', 'skip seal/signature detection')
    .action(async (paths: string[], opts: ExtractOpts) => {
      const parser = createFileParser(buildConfig(opts));
      const parseOptions: Parameters<typeof parser.parse>[1] = {};
      if (opts.fullPages) parseOptions.fullPages = true;
      if (opts.force) parseOptions.force = true;
      if (opts.detectSeals === false) parseOptions.detectSeals = false;

      const classified = await classifyInputs(paths);

      const concurrency = opts.concurrency
        ? Math.max(1, Number(opts.concurrency) || 1)
        : Math.max(1, Math.min(classified.parseInputs.length || 1, 10));

      const batch =
        classified.parseInputs.length > 0
          ? await parseMany(parser, classified.parseInputs, { concurrency, parse: parseOptions })
          : { items: [] as ParseManyItem[], ok: 0, failed: 0, total: 0, totalMs: 0 };

      // Write .md for each successful parse + build lookup by path.
      const byPath = new Map<string, ExtractSummaryItem>();
      const ensuredDirs = new Set<string>();
      for (const item of batch.items) {
        const entry: ExtractSummaryItem = {
          path: item.path,
          ok: item.ok,
          durationMs: item.durationMs,
        };
        if (item.ok && item.result) {
          const inputDir = dirname(item.path);
          const inputBase = basename(item.path);
          const stem = inputBase.replace(new RegExp(`${escapeRegExp(extname(inputBase))}$`), '');
          const outDir = opts.out ?? inputDir;
          if (!ensuredDirs.has(outDir)) {
            await mkdir(outDir, { recursive: true });
            ensuredDirs.add(outDir);
          }
          const outPath = join(outDir, `${stem}.md`);
          await writeFile(outPath, toMarkdown(item.result), 'utf8');
          entry.outFile = outPath;
        } else {
          if (item.error) entry.error = item.error;
          if (item.code) entry.code = item.code;
        }
        byPath.set(item.path, entry);
      }
      for (const p of classified.passthroughInputs) {
        byPath.set(p, { path: p, ok: true, durationMs: 0, message: 'Already a text file' });
      }

      // Assemble items in slot order.
      const items: ExtractSummaryItem[] = [];
      for (const slot of classified.slots) {
        if (slot.kind === 'archive-failed') {
          items.push({
            path: slot.path,
            ok: false,
            durationMs: 0,
            error: slot.error ?? 'archive expansion failed',
            ...(slot.code ? { code: slot.code } : {}),
          });
          continue;
        }
        const entry = byPath.get(slot.path);
        if (entry) items.push(entry);
      }

      const ok = items.filter((i) => i.ok).length;
      const failed = items.filter((i) => !i.ok).length;
      const total = items.length;

      const summary: Record<string, unknown> = {
        total,
        ok,
        failed,
        totalMs: batch.totalMs,
        items,
      };
      if (classified.archives.length > 0) summary.archives = classified.archives;

      writeJson(summary);

      if (failed > 0) process.exitCode = 3;
    });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keep re-exports for consumers/tests that import the input slot type.
export type { InputSlot };
