# 001 · filecrystal — Specification

> Spec-Driven Development · Specification (WHY / WHAT)
> Status: Draft · Version: 0.1.0 · Owner: stone

## 1. Overview

**filecrystal** is a universal file parser that converts PDFs, images (jpg/png),
spreadsheets (xlsx/xls) and Word documents (doc/docx) into a single, well-typed
`ParseResult` JSON. When a `prompt` is provided, it additionally extracts
structured fields with per-field locators (page/bbox, sheet/cell, doc-anchor).

Primary audience:

- **Node.js SDK consumers** — any app that needs a consistent
  "file → Markdown / prompt-defined JSON" abstraction backed by any
  OpenAI-compatible API.
- **CLI users / ops** — shell scripts, CI pipelines, batch jobs, regression
  runs, language-agnostic integrations.

## 2. User Stories

- **S1 — SDK integration**: as a Node.js developer, I `import { createFileParser,
  parseMany, toMarkdown }` from `filecrystal`, point it at any OpenAI-compatible
  endpoint, and turn a mixed-format inbox into normalised Markdown + metrics
  with a single `parseMany` call.
- **S2 — CLI triage**: as an operator, I run
  `filecrystal extract ./contract.pdf && filecrystal structure ./contract.md
  --prompt ./prompts/contract.prompt.md` to inspect a file's text and then
  its extracted fields.
- **S3 — Prompt-driven extraction**: as a domain engineer, I write a prompt
  file (Markdown + YAML frontmatter) describing the exact JSON shape I want,
  and filecrystal returns that shape verbatim — with JSON-repair + `{text}`
  fallback so non-JSON responses never break my pipeline.

## 3. Scope

**In-scope**: pdf, jpg, png, xlsx, xls, doc, docx. Mock mode for offline
development. OpenAI-compatible chat/vision for OCR, seal/signature detection
and prompt-based field extraction. Disk cache keyed by fileHash + config.
Quality/performance/cost metrics per parse.

**Out-of-scope** (may be added later): video, audio, rtf, pptx, csv, html,
encrypted PDFs (reported as `ERR_PROTECTED_FILE`), translation, summarisation.

## 4. Functional Requirements

- **FR-1** — `createFileParser(config)` returns a `FileParser` with a single
  `parse(path, options?)` method.
- **FR-2** — Without `options.prompt`, the result contains `source`, `raw`,
  `metrics` and `warnings?` but no `extracted`.
- **FR-3** — With `options.prompt`, the result additionally contains
  `extracted` where each entry is an `ExtractedField<T>`.
- **FR-4** — Each `ExtractedField` carries `confidence` and, when the LLM
  supplies a `locator_hint`, a resolved `SourceLocator`.
- **FR-5** — xls **and** xlsx are parsed through SheetJS with the same code
  path; cell values, formulas and merged ranges are preserved.
- **FR-6** — PDFs with a text layer skip OCR; scanned PDFs fall back to
  `@napi-rs/canvas` rendering plus an OpenAI-compatible vision OCR call.
- **FR-7** — Seal and signature detection runs on PDF / image / docx-embedded
  images unless `options.detectSeals === false`. Detection may piggy-back on
  the OCR request when `seal.mergeWithOcr === true`.
- **FR-8** — Long documents (pages > `truncation.maxPages`) are truncated to a
  head+tail window (default 7+3 of the first 10 pages). `options.fullPages`
  bypasses truncation.
- **FR-9** — Results are cached on disk under `cacheDir/{hash}.json` with
  atomic writes and file locking.
- **FR-10** — `MetricsCollector` records `quality`, `performance` and `cost`
  (yuan, using `MODEL_PRICING`).
- **FR-11** — The OCR / LLM backends are **OpenAI-compatible**: `baseUrl`,
  `apiKey` and `model` are the only required settings. Built-in presets for
  百炼 (qwen) and OpenAI ship with sensible defaults.
- **FR-12** — The CLI command `filecrystal` mirrors the library API via
  `parse <path>` and `schema`.

## 5. Non-Functional Requirements

- **Performance** — see §11.4 of the plan doc. p95 ≤ 20 s / file for a mixed
  7-file corpus; xlsx ≤ 200 ms.
- **Reliability** — retry with exponential backoff (max 2 retries) on LLM/OCR
  failures. Surface a `warnings[]` entry when a stage degrades gracefully.
- **Cost** — avg ≤ ¥0.05 per file for the default model mix (qwen).
- **Portability** — Node.js ≥ 18.18. Windows / macOS / Linux. No
  `node-gyp`-based native modules in the critical path (`@napi-rs/canvas` is
  prebuilt).
- **Security** — API keys travel via config objects or env vars only. Never
  serialised into `ParseResult`, `metrics` or logs.

## 6. Data Contract

Canonical TypeScript contract lives at `specs/001-file-parser/contracts/
types.d.ts` and is exported at runtime from `src/types.ts` /
`filecrystal/schema`. Any breaking change to this contract requires a
changeset and a bump of `SCHEMA_VERSION`.

## 7. Error Model

All thrown errors are instances of `FileParserError` with a stable `code`:
`ERR_UNSUPPORTED_FORMAT`, `ERR_FILE_NOT_FOUND`, `ERR_PROTECTED_FILE`,
`ERR_OCR_TIMEOUT`, `ERR_OCR_FAILED`, `ERR_LLM_JSON_PARSE`, `ERR_LLM_TIMEOUT`,
`ERR_CONFIG_INVALID`, `ERR_CACHE_IO`.

## 8. Acceptance Criteria

- `pnpm test` passes with ≥ 80 % statement coverage on `src/**/*.ts`
  (excluding `cli.ts` and `mocks/**`).
- `pnpm build` produces a `dist/` with `index.mjs`, `index.cjs`, `index.d.ts`,
  `schema.mjs`, `schema.cjs`, `schema.d.ts`, `cli.js` (≤ 2 MB total).
- `pnpm cli -- parse tests/fixtures/sample.xlsx --mode mock --pretty` prints a
  valid `ParseResult` with `source.fileFormat === 'xlsx'`.
- E2E (when `FILECRYSTAL_BASE_URL` + `FILECRYSTAL_API_KEY` are set) exercises
  at least one real OpenAI-compatible provider call end-to-end.

## 9. Open Questions

- **Q1** — GitHub organisation / owner for the public repo (currently
  `<ORG>` placeholder in `package.json`).
- **Q2** — Pricing fidelity: should `pricing.ts` be auto-synced with an
  upstream YAML maintained by the provider team, or kept as hand-curated
  constants?
- **Q3** — Should encrypted xlsx files throw `ERR_PROTECTED_FILE`
  unconditionally, or accept an optional `password` option?
