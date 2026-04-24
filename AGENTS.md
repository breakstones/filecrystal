# filecrystal

## Project

TypeScript universal file parser published to npm. Exposes two integration
surfaces that produce the same output shape:

- **CLI** (`filecrystal extract` / `filecrystal structure`) — for shell
  scripts, CI pipelines and language-agnostic integrations.
- **SDK** (`createFileParser` / `createStructuredExtractor` / `parseMany` /
  `toMarkdown`) — for Node.js applications.

## Stack

pnpm 9+ · Node ≥ 18.18 · ESM primary + CJS interop · `tsup` build · `vitest`
tests · `changesets` versioning.

Runtime libs: `xlsx` (SheetJS) · `pdfjs-dist` · `@napi-rs/canvas` ·
`mammoth` + `word-extractor` · `sharp` · `openai` SDK · `zod` · `p-limit` ·
`gray-matter` · `commander` · `mime-types`.

## Commands

- `pnpm dev` — watch-mode build.
- `pnpm build` — emit `dist/index.{js,cjs,d.ts}`, `dist/schema.*` and
  `dist/cli.js`.
- `pnpm typecheck` / `pnpm lint` / `pnpm format`.
- `pnpm test` — unit tests (mock LLM/OCR) with coverage.
- `pnpm test:e2e` — real-file tests (requires `FILECRYSTAL_MODEL_BASE_URL` +
  `FILECRYSTAL_MODEL_API_KEY`; defaults validate against 百炼).
- CLI subcommands (api-only — CLI has no mock mode):
  - `filecrystal extract <paths...> [--out dir] [--concurrency N]` — parses
    files to Markdown; each input produces `<name>.md`.
  - `filecrystal structure <inputs...> [--prompt file | --prompt-text str]` —
    LLM-driven field extraction. Text inputs (`.md` / `.markdown` / `.txt`)
    pass through; raw files (pdf/xlsx/docx/image/zip) go through the same
    `extract` pipeline internally (`classifyInputs` → `parseMany` →
    `toMarkdown`). All inputs are concatenated in argv order and sent in a
    single LLM call by default. Batching + shallow-merge only triggers when
    the combined text exceeds `--max-input-chars` (default 500 000).

## Architecture

Two-stage pipeline, each stage exposed as its own public API and CLI:

- **Stage 1 — `createFileParser` / `parseMany` / `filecrystal extract`**:
  raw text extraction per file (xlsx/pdf/docx/image). No LLM in the critical
  path unless a page needs OCR.
- **Stage 2 — `createStructuredExtractor` / `filecrystal structure`**: accepts
  `StructureSource[]` (`{ name, text }`) — each entry is already-Markdown —
  concatenates them with `# File: <name>` headings in argv order, sends one
  LLM call by default, and passes the model's JSON output through verbatim
  (prompt owns the schema). Only splits into batches when combined text
  exceeds `maxInputChars` (default 500 000); per-batch results shallow-merge
  by top-level key. Falls back to `{ text: ... }` when JSON repair can't
  recover the response. Stage 2 never calls `parser.parse` — callers who
  need to feed raw files should use Stage 1 first (or the CLI, which wires
  both stages internally).

OCR and LLM backends are unified behind the **OpenAI-compatible** interface
(`baseUrl` + `apiKey` + `model`); 百炼 is the default preset. See
`specs/001-file-parser/plan.md`.

## Testing

- Unit tests mock `OcrBackend` / `LlmBackend`.
- E2E tests are gated on `FILECRYSTAL_MODEL_BASE_URL` +
  `FILECRYSTAL_MODEL_API_KEY`.
- Fixtures committed to git are < 1 MB; larger samples are fetched via
  `scripts/` on demand.

## Non-Negotiables

- ESM-first. No runtime `require(...)`.
- Changing a public type or JSON shape requires a changeset.
- New extractor must land with a unit test and at least one fixture.
- Never write API keys into `metrics`, `warnings`, snapshots or logs.
- The CLI must never print anonymised/sanitised sensitive data it doesn't
  own (no real corp names, real bank accounts, real IDs in docs or tests).
- **Remote side-effects require explicit user approval**. The assistant
  may freely do local work (edit files, run build/test/typecheck/lint,
  read-only git commands, `npm pack --dry-run`, write benchmark reports
  under `tests/reports/`), but must **ask first** before running any of:
  `git add` / `git commit` / `git push` / `git tag` / `git push --tags` /
  `pnpm changeset version` / `pnpm publish` / `npm publish` / any command
  that mutates git remotes, `git config`, or `npm config`. After a
  self-contained unit of local work, the assistant reports "ready to
  commit/push/publish?" and waits for confirmation.

## Quality Gates

- coverage ≥ 80 % · typecheck zero errors · ESLint zero errors · `dist/`
  total ≤ 2 MB.
- E2E (with API key): `overallFieldAccuracy ≥ 0.85`, `p95Ms ≤ 20000`,
  `avgPerFileYuan ≤ 0.05`.

## Don't

- Do not tailor `src/` business logic to a single caller; keep the contract
  provider-neutral.
- Do not commit build products outside `dist/` (and `dist/` is gitignored).
- Do not commit `tests/reports/`, `tmp_data/`, or `api-key.txt`.
- Do not touch `specs/001-file-parser/contracts/types.d.ts` without also
  updating `src/types.ts` in the same PR.
