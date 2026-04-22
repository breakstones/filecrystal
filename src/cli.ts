import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { createFileParser } from './parser.js';
import type { FileParserConfig } from './types.js';

const program = new Command();

program
  .name('filecrystal')
  .description('Universal file parser for PDFs, images, xlsx/xls, docx with structured extraction')
  .version('0.1.0');

program
  .command('parse')
  .description('Parse a file and output ParseResult JSON')
  .argument('<path>', 'path to the file')
  .option('--prompt <file>', 'path to a prompt file (Markdown with frontmatter)')
  .option('--mode <mode>', 'parser mode: mock | api', 'mock')
  .option('--base-url <url>', 'OpenAI-compatible base URL (env: FILECRYSTAL_BASE_URL)')
  .option('--api-key <key>', 'OpenAI-compatible API key (env: FILECRYSTAL_API_KEY)')
  .option('--ocr-model <model>', 'OCR model (env: FILECRYSTAL_OCR_MODEL)')
  .option('--vision-model <model>', 'vision model (env: FILECRYSTAL_VISION_MODEL)')
  .option('--text-model <model>', 'text model (env: FILECRYSTAL_TEXT_MODEL)')
  .option('--full-pages', 'disable head-tail truncation for long PDF/docx')
  .option('--force', 'skip cache')
  .option('--no-detect-seals', 'skip seal/signature detection')
  .option('--pretty', 'pretty-print JSON output')
  .action(async (filePath: string, opts) => {
    const mode: 'mock' | 'api' = opts.mode === 'api' ? 'api' : 'mock';
    const config: FileParserConfig = { mode };
    if (mode === 'api') {
      const baseUrl = opts.baseUrl ?? process.env.FILECRYSTAL_BASE_URL;
      const apiKey = opts.apiKey ?? process.env.FILECRYSTAL_API_KEY;
      if (!baseUrl || !apiKey) {
        console.error(
          'mode "api" requires --base-url and --api-key (or FILECRYSTAL_BASE_URL / FILECRYSTAL_API_KEY env).',
        );
        process.exit(2);
      }
      config.openai = {
        baseUrl,
        apiKey,
        models: {
          ocr: opts.ocrModel,
          vision: opts.visionModel,
          text: opts.textModel,
        },
      };
    }

    const parser = createFileParser(config);
    let promptContent: string | undefined;
    if (opts.prompt) {
      promptContent = await readFile(opts.prompt, 'utf8');
    }
    const parseOpts: Parameters<typeof parser.parse>[1] = {};
    if (promptContent) parseOpts.prompt = promptContent;
    if (opts.fullPages) parseOpts.fullPages = true;
    if (opts.force) parseOpts.force = true;
    if (opts.detectSeals === false) parseOpts.detectSeals = false;

    const result = await parser.parse(filePath, parseOpts);
    process.stdout.write(opts.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result));
    process.stdout.write('\n');
  });

program
  .command('schema')
  .description('Print the JSON Schema of ParseResult')
  .action(async () => {
    const { getParseResultJsonSchema } = await import('./schema/index.js');
    process.stdout.write(JSON.stringify(getParseResultJsonSchema(), null, 2));
    process.stdout.write('\n');
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error('[filecrystal]', err.message);
  process.exit(1);
});
