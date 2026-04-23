# filecrystal

> Universal file parser for PDFs, images, xlsx/xls and docx — with structured
> field extraction via any **OpenAI-compatible** API.

[![npm](https://img.shields.io/npm/v/filecrystal.svg)](https://www.npmjs.com/package/filecrystal)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![node](https://img.shields.io/badge/node-%E2%89%A518.18-brightgreen.svg)

## Why

One consistent `ParseResult` for every supported file format, plus a
**Markdown-first** pipeline. Plug any OpenAI-compatible provider (OpenAI /
Moonshot / DeepSeek / 阿里百炼 / self-hosted vLLM) for OCR, seal detection and
prompt-driven field extraction — switching provider is a change of `baseUrl` +
`model`, not a code rewrite.

## Install

```bash
pnpm add filecrystal
# or
npm i filecrystal
```

## Quick start (CLI)

Two focused subcommands: **`extract`** (files → Markdown) and **`structure`**
(Markdown / files → prompt-defined JSON).

```bash
# 1. Parse files to Markdown — defaults to writing next to each input
filecrystal extract ./a.pdf ./b.xlsx
# → ./a.md  ./b.md

# Write to a dedicated directory
filecrystal extract ./*.pdf --out ./out/

# 2. Extract structured fields with a prompt (file or inline)
filecrystal structure ./out/a.md --prompt ./prompts/contract.prompt.md
filecrystal structure ./out/a.md --prompt-text '输出 JSON: {"title":"..."}'
```

Full option reference: [`docs/CLI.md`](./docs/CLI.md).

### Credentials

```bash
# Default: Alibaba 百炼 (Qwen). Swap baseUrl + model for any OpenAI-compatible provider.
export FILECRYSTAL_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export FILECRYSTAL_MODEL_API_KEY=sk-your-key-here

# Optional overrides
export FILECRYSTAL_VISION_MODEL=qwen-vl-ocr-latest        # OCR + seal detection
export FILECRYSTAL_TEXT_MODEL=qwen-plus                   # structure stage
export FILECRYSTAL_VISION_MODEL_THINKING=false            # Qwen3 reasoning for OCR
export FILECRYSTAL_TEXT_MODEL_THINKING=false              # Qwen3 reasoning for structure
```

## Quick start (library)

```ts
import { createFileParser, createStructuredExtractor, parseMany, toMarkdown } from 'filecrystal';

// --- Mock mode — works offline, deterministic placeholders ---
const parser = createFileParser({ mode: 'mock' });
const { raw, source } = await parser.parse('./contract.pdf');
const md = toMarkdown({ raw, source });

// --- API mode ---
const apiParser = createFileParser({
  mode: 'api',
  openai: {
    baseUrl: process.env.FILECRYSTAL_MODEL_BASE_URL!,
    apiKey: process.env.FILECRYSTAL_MODEL_API_KEY!,
    models: { ocr: 'qwen-vl-ocr-latest', vision: 'qwen-vl-max', text: 'qwen-plus' },
  },
});

// --- Batch: many files concurrently ---
const batch = await parseMany(apiParser, ['./a.pdf', './b.xlsx'], { concurrency: 3 });

// --- Structured extraction: pass the prompt's JSON shape through verbatim ---
const extractor = createStructuredExtractor({
  mode: 'api',
  openai: { /* same as above */ },
});
const { extracted } = await extractor.extract(
  batch.items.filter((i) => i.ok).map((i) => ({ name: i.result!.source.fileName, raw: i.result!.raw })),
  { prompt: customPromptMarkdown /* optional */ },
);
```

## Supported formats

| Format | Notes |
|---|---|
| **xlsx / xls** | SheetJS; cells, merges, formulas |
| **pdf** | text-layer first, OCR fallback via `@napi-rs/canvas` + `sharp` preprocess |
| **jpg / png** | `sharp` preprocessing (EXIF rotate, long-edge 2000, JPEG q85) → OCR |
| **docx / doc** | `mammoth` main + `word-extractor` fallback; embedded images scanned for seals |

## Output shape (library)

```ts
interface ParseResult {
  schemaVersion: '1.0';
  parsedAt: string;
  parserVersion: string;
  source: ParsedSource;       // filePath, fileName, fileFormat, fileHash, pageCount, ...
  raw: ParsedRaw;             // pages | sheets | sections | fullText | seals | signatures
  extracted?: Record<string, unknown>;  // only when options.prompt — prompt owns the schema
  metrics: ParseMetrics;      // quality / performance / cost (CNY)
  warnings?: string[];
}
```

Full TypeScript contract: [`specs/001-file-parser/contracts/types.d.ts`](./specs/001-file-parser/contracts/types.d.ts).
JSON Schema at runtime:

```ts
import { getParseResultJsonSchema } from 'filecrystal/schema';
console.log(getParseResultJsonSchema());
```

## Integration examples

Both integration surfaces — CLI and SDK — produce the same output shape. Pick
either for your workflow.

| Surface | When to use | Demo |
|---|---|---|
| **CLI** | shell scripts · CI pipelines · language-agnostic integrations | [`examples/cli-workflow.sh`](./examples/cli-workflow.sh) |
| **SDK** | Node.js apps · custom pre/post-processing · tight error handling | [`examples/sdk-workflow.mjs`](./examples/sdk-workflow.mjs) |

Both walk through the same two stages: `extract` → Markdown, then
`structure` → prompt-defined JSON. See [`examples/README.md`](./examples/README.md)
for the quick-start commands.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Spec-driven docs live in [`specs/001-file-parser/`](./specs/001-file-parser/).
Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
