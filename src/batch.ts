import { basename, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createLimiter } from './utils/concurrency.js';
import type { FileParser, ParseOptions, ParseResult } from './types.js';

export interface ParseManyOptions {
  /** Parallel file parses (default 3). */
  concurrency?: number;
  /**
   * When set, writes each successful result as `<basename>.parsed.json` here
   * (directory is created if needed). When unset, results are only returned.
   */
  outDir?: string;
  /** Passed through to each {@link FileParser.parse} call. */
  parse?: ParseOptions;
}

export interface ParseManyItem {
  path: string;
  ok: boolean;
  result?: ParseResult;
  outFile?: string;
  error?: string;
  code?: string;
  durationMs: number;
}

export interface ParseManyResult {
  total: number;
  ok: number;
  failed: number;
  items: ParseManyItem[];
  totalMs: number;
}

/**
 * Concurrent raw parse across many files. Individual failures never abort
 * the whole batch; each file's success/error is recorded per-item.
 */
export async function parseMany(
  parser: FileParser,
  paths: string[],
  options: ParseManyOptions = {},
): Promise<ParseManyResult> {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const limiter = createLimiter(concurrency);
  const started = Date.now();

  if (options.outDir) await mkdir(options.outDir, { recursive: true });

  const items = await Promise.all(
    paths.map((p) =>
      limiter(async (): Promise<ParseManyItem> => {
        const t0 = Date.now();
        try {
          const result = await parser.parse(p, options.parse ?? {});
          const item: ParseManyItem = {
            path: p,
            ok: true,
            result,
            durationMs: Date.now() - t0,
          };
          if (options.outDir) {
            const outFile = join(options.outDir, `${basename(p)}.parsed.json`);
            await writeFile(outFile, JSON.stringify(result, null, 2), 'utf8');
            item.outFile = outFile;
          }
          return item;
        } catch (err) {
          const e = err as { message?: string; code?: string };
          return {
            path: p,
            ok: false,
            error: e?.message ?? String(err),
            ...(e?.code ? { code: e.code } : {}),
            durationMs: Date.now() - t0,
          };
        }
      }),
    ),
  );

  return {
    total: items.length,
    ok: items.filter((i) => i.ok).length,
    failed: items.filter((i) => !i.ok).length,
    items,
    totalMs: Date.now() - started,
  };
}
