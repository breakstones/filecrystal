# filecrystal

## 0.6.0

### Minor Changes

- 46b1f46: Add two environment variables for tuning concurrency, with more
  aggressive defaults suited to production workloads.

  **`FILECRYSTAL_FILE_CONCURRENCY`** — CLI file-level parallelism for
  `extract` and `structure` (when raw files are involved). Overridden by
  the CLI `--concurrency` flag; otherwise the default is
  `min(<files>, 20)`. Both commands now share this default:
  - `extract --concurrency` default: `min(<files>, 10)` → **`min(<files>, 20)`**.
  - `structure --concurrency` default: `3` → **`min(<raw files>, 20)`**.

  **`FILECRYSTAL_OCR_CONCURRENCY`** — process-scoped OCR / vision
  parallelism (every page from every file competes for this pool).
  Overridden by `FileParserConfig.ocr.maxConcurrency`. Default raised
  from **`18` → `24`**.

  ### When to tune
  - Hitting DashScope `429` / rate limit on OCR → set
    `FILECRYSTAL_OCR_CONCURRENCY=8` (or lower).
  - Higher quota / multi-account aggregation → raise
    `FILECRYSTAL_OCR_CONCURRENCY=32` and optionally
    `FILECRYSTAL_FILE_CONCURRENCY=40`.
  - Pair with `UV_THREADPOOL_SIZE=16` to give `sharp` / `@napi-rs/canvas`
    more native threads during image preprocessing.

  Invalid or non-positive env values are silently ignored (fall back to
  the defaults) so a stray `0` never aborts a batch.

  No public API or CLI-flag changes. Callers happy with the old values
  can pin them explicitly via `FILECRYSTAL_FILE_CONCURRENCY=10` and
  `FILECRYSTAL_OCR_CONCURRENCY=18`.

## 0.5.1

### Patch Changes

- 9ef0245: Fix: `filecrystal --version` / `-V` now returns the actual installed
  package version instead of the hardcoded `0.1.0` it shipped with since
  v0.1.0. The CLI and `ResolvedConfig.parserVersion` (surfaced on every
  `ParseResult.parserVersion`) both resolve the version at runtime from
  the shipped `package.json`, so every release auto-stamps itself.

  Before (on v0.5.0): `npx filecrystal -V` → `0.1.0`.
  After (on v0.5.1): `npx filecrystal -V` → `0.5.1`.

## 0.5.0

### Minor Changes

- b391aa3: `filecrystal structure` is now text-first and single-prompt by default.

  The structure stage no longer calls `parser.parse` itself. Text inputs
  (`.md` / `.markdown` / `.txt`) pass through unchanged; raw files
  (pdf/xlsx/docx/image/zip) are routed through the existing `extract`
  pipeline (`classifyInputs` → `parseMany` → `toMarkdown`) to produce
  Markdown. All inputs are concatenated in argv order with `# File: <name>`
  headings and `---` separators, then sent to the LLM in a **single call**
  by default. Batching + shallow-merge only kicks in when the combined text
  exceeds `--max-input-chars` (default raised from 80 000 to 500 000).

  ### Breaking changes
  - `StructureSource` is now `{ name: string; text: string }` (was
    `{ name?: string; raw: ParsedRaw }`). Migrate existing SDK callers with
    `{ name: r.source.fileName, text: toMarkdown(r) }`.
  - `buildUserPrompt(body, raw: ParsedRaw)` → `buildUserPrompt(body, text: string)`.
    The prompt body + `【文档原文】` anchor + joined text format is preserved;
    only the input shape changed.
  - CLI no longer accepts `.parsed.json` inputs. SDK users who persisted
    those artefacts can rehydrate with `JSON.parse` → `toMarkdown` before
    passing to the structure stage.
  - Default `maxInputChars` raised from 80 000 to 500 000 — typical
    multi-document inputs now fit in one LLM call. Pass
    `--max-input-chars <n>` (CLI) or `maxInputChars` (SDK) to force
    batching for very large inputs.
  - Default `text` model changed from `qwen-plus` to `qwen3.6-plus`.
    Both the CLI (`--text-model`) and the SDK
    (`FileParserConfig.openai.models.text`) inherit the new default.
    `qwen3.6-plus` is a Qwen3 reasoning-capable model; thinking stays
    off by default because `enable_thinking: false` is now forwarded
    explicitly on every request (see the companion patch changeset).
    Set `FILECRYSTAL_TEXT_MODEL=qwen-plus` to keep the old behaviour.
  - Summary JSON shape: `inputs[].kind` enum loses `'parsed-json'` /
    `'markdown'` / `'raw-file'` in favour of `'parsed'` / `'passthrough'`.
    The summary gains `archives` (when `.zip` inputs are given) and
    `parseFailures` (when any raw file or archive fails). Process exit code
    is `3` when `parseFailures` is non-empty, matching `extract`.

  ### Non-breaking additions
  - `createStructuredExtractor(config, overrides?)` takes an optional second
    argument for injecting a custom `LlmBackend` — primarily useful for
    tests that need to inspect the assembled user prompt.
  - `createMockLlmBackend({ record: true })` now captures every request
    it sees (`backend.requests` / `backend.lastRequest`) to support that
    inspection.

### Patch Changes

- b391aa3: Fix: `enableThinking` is now honoured on every LLM/OCR request, not just
  when opted in to `true`.

  Previously the backend/request code would _omit_ the `enable_thinking`
  field entirely when `cfg.*.enableThinking` was `false` (the default). For
  Qwen3 reasoning models (e.g. `qwen3-plus`, `qwen3.6-plus`), DashScope
  defaults the server-side behaviour to **thinking enabled** when the field
  is absent, so the documented "thinking off by default" contract was
  silently broken on those models — up to 8× higher latency and 10×+ more
  completion tokens.

  What changed:
  - `src/structure.ts` and `src/parser.ts` now always forward
    `extraBody.enable_thinking: <boolean>` on every LLM call, computing the
    effective value as `frontmatter.thinking ?? cfg.extraction.enableThinking`.
  - `src/parser.ts` OCR backends now always pass
    `extraBody.enable_thinking: cfg.ocr.enableThinking` (was only forwarded
    when `true`).
  - No public API changes; `FileParserConfig.{ocr,extraction}.enableThinking`
    keeps the same shape and default (`false`).

  Live verification against `qwen3.6-plus`: default path drops from
  ~9.9 s / 484 completion tokens (reasoning silently running) to
  ~1.8 s / 36 completion tokens (reasoning actually off). Explicit
  `frontmatter: thinking: true` still opts back in.

## 0.4.0

### Minor Changes

- f3b4308: `filecrystal extract` now accepts `.zip` archives and already-text inputs
  transparently.
  - **zip inputs** are expanded into a same-named sibling directory
    (`docs/bundle.zip` → `docs/bundle/`), and every supported file inside
    is routed through the usual parse pipeline. Nested zips are preserved
    on disk but not recursed (safety + zip-bomb avoidance); each produces
    a warning. Entries with path-traversal or absolute-path names are
    rejected (zip-slip defense). Output `.md` files land next to their
    extracted source.
  - **text passthroughs** (`.md` / `.markdown` / `.txt`) — whether passed
    directly on the command line or found inside a zip — skip the parser
    entirely and are reported as `{ ok: true, durationMs: 0, message:
"Already a text file" }` in the summary. No file is rewritten.
  - mixed inputs (e.g. `a.pdf notes.md bundle.zip`) are fully supported;
    the summary preserves the user's original argv order with zip entries
    slotted after their parent in alphabetical order.
  - summary JSON gains an optional `archives[]` top-level field documenting
    each zip's extraction target, counts (`expanded` / `passthrough`) and
    warnings.

  Runtime: adds `jszip ^3.10.1` as a direct dependency.

## 0.3.0

### Minor Changes

- fc3ac75: Prompt frontmatter now supports a `thinking: true|false` field that opts a
  single prompt into or out of provider reasoning mode (e.g. Qwen3
  `enable_thinking`). Takes precedence over the env-level default
  `FILECRYSTAL_TEXT_MODEL_THINKING`, so you can force-on reasoning for a
  complex-extraction prompt while keeping other prompts fast, or force-off
  reasoning on a specific prompt even when the env default is on.

  Also exposed per-request `extraBody` on `LlmExtractRequest`, merged over
  backend-level `extraBody` (request wins), so any provider-specific switch
  can be overridden on a per-call basis.

## 0.2.0

### Minor Changes

- b015a61: Initial public release of filecrystal: TypeScript universal file parser that
  turns PDFs / images / xlsx / docx into Markdown, with prompt-driven structured
  JSON extraction via any OpenAI-compatible API. Ships with a type-safe
  `ParseResult` contract, OCR + vision + seal/signature detection, built-in
  Markdown rendering (`toMarkdown`), JSON-fix + text fallback for the LLM
  stage, a `filecrystal` CLI with `extract` and `structure` subcommands, and
  parallel `parseMany` batch execution.

Changelog is maintained by [changesets](https://github.com/changesets/changesets).
The first entry appears when the first release is tagged.
