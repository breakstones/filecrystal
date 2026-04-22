# 001 · filecrystal — Plan

> Spec-Driven Development · Plan (HOW)
> Pairs with `spec.md`. Version: 0.1.0.

## 1. Architecture

Two-layer pipeline:

```
parse(filePath, options)
  ├─ Layer 1  FormatExtractor     → ParsedRaw
  │    ├─ XlsxExtractor (SheetJS, xls+xlsx)
  │    ├─ PdfExtractor  (pdfjs-dist text layer → @napi-rs/canvas + OCR fallback)
  │    ├─ DocxExtractor (mammoth + word-extractor)
  │    └─ ImageExtractor (sharp preprocessing → OCR)
  │
  └─ Layer 2  PromptExtractor     → extracted    (only when options.prompt)
       └─ LlmBackend (OpenAI-compatible chat, response_format=json_object)
         + resolveLocator (LLM locator_hint → SourceLocator)
```

Layer 1 always runs. Layer 2 is gated on `options.prompt`. The contract
between layers is `ParsedRaw` — page / sheet / section variants.

## 2. Module Map

See `src/` tree in the repo root. One file per responsibility; extractors,
OCR backends, LLM backends, seal detector, cache, metrics, mocks and utils
are each isolated folders.

## 3. Technology Choices

| Concern | Choice | Rationale |
|---|---|---|
| xls/xlsx | `xlsx` (SheetJS) | same API for both; avoids `exceljs` xlsx-only limit |
| PDF text layer | `pdfjs-dist` | stable; used without DOM |
| PDF rasterisation | `@napi-rs/canvas` | prebuilt NAPI binaries; no node-gyp on Windows |
| docx | `mammoth` (+ `word-extractor` for .doc) | mammoth maintains section/heading structure |
| image preprocessing | `sharp` | EXIF rotation + long-edge scale + grayscale |
| OCR / vision / chat | **OpenAI-compatible** via `openai` SDK | any provider; default preset 百炼 |
| validation | `zod` | runtime + static types in one definition |
| JSON Schema | `zod-to-json-schema` | published alongside the TS types |
| concurrency | `p-limit` + `proper-lockfile` | per-request + cross-process |
| prompt parsing | `gray-matter` | reuse markdown frontmatter |
| build | `tsup` | ESM+CJS+DTS+cli in one config |
| tests | `vitest` | fast, ESM-native, coverage via v8 |

## 4. Interfaces

All runtime-pluggable behaviours are expressed as backend interfaces:

- `FormatExtractor` — implicit through the `extract*` functions per format.
- `OcrBackend.recognize({ imageBuffer, detectSealsAndSignatures? })`.
- `LlmBackend.extract({ systemPrompt, userPrompt, model?, temperature? })`.
- `SealDetector.detect(imageBuffer, pageNo?)` — a thin layer over an
  `OcrBackend` that piggy-backs seal+signature output.

The default implementations (`createOpenAICompat*Backend`) accept
`{ baseUrl, apiKey, model }`. The presets (`createQwen*`,
`createOpenAI*`) only fill in sensible defaults for those three fields.

## 5. Caching & Concurrency

- Cache key = `sha256(fileHash | configFingerprint | promptHash?)` — see
  `src/cache/key.ts`.
- File writes go through `proper-lockfile` with a temp-file rename, so a
  crash never leaves a half-written cache entry.
- Per-parse concurrency is bounded by `ocr.maxConcurrency` (default 3) using
  `p-limit`. A global semaphore in `src/utils/concurrency.ts` prevents
  cross-parse QPS spikes.

## 6. Observability

`MetricsCollector` aggregates `quality`, `performance` and `cost` into a
`ParseMetrics` attached to every `ParseResult`. Cost is converted to CNY via
`MODEL_PRICING` in `src/llm/pricing.ts`. When a batch report is produced by
`scripts/report.mjs`, we summarise across files.

## 7. Security

- API keys are never added to `metrics`, `warnings` or JSON snapshots.
- The CLI accepts `--api-key` but discourages passing it inline; env vars
  are preferred.
- Input paths are not executed; only read via `fs.readFile` /
  `fs.createReadStream`.

## 8. Release Strategy

- `0.1.x` — initial MVP. Breaking changes permitted per changeset.
- `0.9.0` — beta, contract frozen.
- `1.0.0` — stable API; further breaking changes require a new major.
- Release automation via `changesets/action@v1` + npm `provenance`.

## 9. Milestones

- **M1 — Foundation & xlsx** (3 d)
- **M2 — PDF text + OCR, image, seal** (5 d)
- **M3 — LLM extraction, docx, CLI polish, ship** (4 d)

Tasks backing each milestone live in `tasks.md`.
