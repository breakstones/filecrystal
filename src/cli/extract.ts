import { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { createFileParser } from '../parser.js';
import { parseMany } from '../batch.js';
import { toMarkdown } from '../markdown.js';
import { buildConfig, writeJson, type CommonOptions } from './shared.js';

interface ExtractOpts extends CommonOptions {
  out?: string;
  concurrency?: string;
  fullPages?: boolean;
  force?: boolean;
  detectSeals?: boolean;
}

export function registerExtractCommand(program: Command): void {
  program
    .command('extract')
    .description('Parse files into Markdown. Multi-file + concurrent. Real OCR + seal detection.')
    .argument('<paths...>', 'one or more file paths (pdf / jpg / png / xlsx / xls / docx / doc)')
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

      const concurrency = opts.concurrency
        ? Math.max(1, Number(opts.concurrency) || 1)
        : Math.min(paths.length, 10);

      const batch = await parseMany(parser, paths, {
        concurrency,
        parse: parseOptions,
      });

      const items: Array<Record<string, unknown>> = [];
      const ensuredDirs = new Set<string>();
      for (const item of batch.items) {
        const entry: Record<string, unknown> = {
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
        items.push(entry);
      }

      writeJson({
        total: batch.total,
        ok: batch.ok,
        failed: batch.failed,
        totalMs: batch.totalMs,
        items,
      });

      if (batch.failed > 0) process.exitCode = 3;
    });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
