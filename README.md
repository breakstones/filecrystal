# filecrystal

> Universal file parser for PDFs, images, xlsx/xls and docx — with structured
> field extraction via any **OpenAI-compatible** API. Built for the
> **OpenClaw** ecosystem but usable anywhere.

[![npm](https://img.shields.io/npm/v/filecrystal.svg)](https://www.npmjs.com/package/filecrystal)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![node](https://img.shields.io/badge/node-%E2%89%A518.18-brightgreen.svg)

## Why

One consistent `ParseResult` JSON for every supported file format. Plug any
OpenAI-compatible provider (OpenAI / Moonshot / DeepSeek / 阿里百炼 / self-
hosted vLLM) for OCR, seal detection and prompt-driven field extraction —
switching provider is a change of `baseUrl` + `model`, not a code rewrite.

## Install

```bash
pnpm add filecrystal
# or
npm i filecrystal
```

## Quick start (library)

```ts
import { createFileParser } from 'filecrystal';
import { readFile } from 'node:fs/promises';

// Mock mode — works offline, deterministic placeholders
const parser = createFileParser({ mode: 'mock' });

const { source, raw } = await parser.parse('./汇总表.xlsx');

// With an extraction prompt (Markdown + frontmatter)
const prompt = await readFile('./prompts/payment-progress-summary.prompt.md', 'utf8');
const { extracted } = await parser.parse('./汇总表.xlsx', { prompt });
```

## Quick start (CLI)

```bash
# Mock — no API key
pnpm dlx filecrystal parse ./汇总表.xlsx --mode mock --pretty

# API — via any OpenAI-compatible endpoint
export FILECRYSTAL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export FILECRYSTAL_API_KEY=sk-xxx
pnpm dlx filecrystal parse ./contract.pdf --mode api --pretty

# Switch provider — just change BASE_URL / model names
export FILECRYSTAL_BASE_URL=https://api.openai.com/v1
export FILECRYSTAL_OCR_MODEL=gpt-4o
```

## Configuration

```ts
const parser = createFileParser({
  mode: 'api',
  openai: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.FILECRYSTAL_API_KEY!,
    models: {
      ocr: 'qwen-vl-ocr-latest',
      vision: 'qwen-vl-max',
      text: 'qwen-plus',
    },
  },
  ocr: { maxConcurrency: 3, timeoutMs: 60_000, retries: 2 },
  seal: { enabled: true, mergeWithOcr: true },
  truncation: { maxPages: 10, headTailRatio: [7, 3], docxMaxChars: 5000 },
});
```

## Supported formats

| Format | Notes |
|---|---|
| **xlsx / xls** | SheetJS; cells, merges, formulas |
| **pdf** | text-layer first, OCR fallback via `@napi-rs/canvas` + vision model |
| **jpg / png** | `sharp` preprocessing (EXIF rotate, grayscale, long-edge 2000) → OCR |
| **docx / doc** | `mammoth` main + `word-extractor` fallback; embedded images scanned for seals |

## Output shape

```ts
interface ParseResult {
  schemaVersion: '1.0';
  parsedAt: string;
  parserVersion: string;
  source: ParsedSource;     // filePath, fileName, fileFormat, fileHash, pageCount, ...
  raw: ParsedRaw;           // pages | sheets | sections | fullText | seals | signatures
  extracted?: Record<string, ExtractedField>;   // only when options.prompt
  metrics: ParseMetrics;    // quality / performance / cost (CNY)
  warnings?: string[];
}
```

Full TypeScript contract: see [`specs/001-file-parser/contracts/types.d.ts`](./specs/001-file-parser/contracts/types.d.ts).
JSON Schema at runtime:

```ts
import { getParseResultJsonSchema } from 'filecrystal/schema';
console.log(getParseResultJsonSchema());
```

## Integrate with OpenClaw

See [`examples/openclaw-hook/`](./examples/openclaw-hook/) for a
`before_prompt_build` hook that parses every attached file in the session's
local directory and injects the result into the LLM system context.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm cli -- parse tests/fixtures/sample.xlsx --mode mock --pretty
```

Spec-driven docs live in [`specs/001-file-parser/`](./specs/001-file-parser/).
Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

MIT © stone
