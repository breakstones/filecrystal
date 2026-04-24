---
"filecrystal": major
---

`filecrystal structure` is now text-first and single-prompt by default.

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
