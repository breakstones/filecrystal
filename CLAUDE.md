# filecrystal

## Project

TypeScript universal file parser published to npm. Main consumer is the
**OpenClaw** ecosystem, which imports it inside the `before_prompt_build`
hook. Secondary usage is a standalone CLI (`filecrystal parse <path>`).

## Stack

pnpm 9+ · Node ≥ 18.18 · ESM primary + CJS interop · `tsup` build · `vitest`
tests · `changesets` versioning.

Runtime libs: `xlsx` (SheetJS) · `pdfjs-dist` · `@napi-rs/canvas` ·
`mammoth` + `word-extractor` · `sharp` · `openai` SDK · `zod` · `p-limit` ·
`proper-lockfile` · `gray-matter` · `commander` · `mime-types`.

## Commands

- `pnpm dev` — watch-mode build.
- `pnpm build` — emit `dist/index.{mjs,cjs,d.ts}`, `dist/schema.*` and `dist/cli.js`.
- `pnpm typecheck` / `pnpm lint` / `pnpm format`.
- `pnpm test` — unit tests (mock LLM/OCR) with coverage.
- `pnpm test:e2e` — real-file tests (requires `FILECRYSTAL_BASE_URL` +
  `FILECRYSTAL_API_KEY`; defaults validate against 百炼).
- `pnpm cli -- parse <path> [--prompt p.md] [--mode mock|api] [--pretty]`.

## Architecture

Layer 1 `FormatExtractor` (xlsx / pdf / docx / image) → Layer 2
`PromptExtractor` (LLM + `resolveLocator`). OCR and LLM backends are unified
behind the **OpenAI-compatible** interface (`baseUrl` + `apiKey` + `model`);
百炼 is the default preset. See `specs/001-file-parser/plan.md`.

## Testing

- Unit tests mock `OcrBackend` / `LlmBackend`.
- E2E tests are gated on `FILECRYSTAL_BASE_URL` + `FILECRYSTAL_API_KEY`.
- Fixtures committed to git are < 1 MB; larger samples are fetched via
  `scripts/` on demand.

## Non-Negotiables

- ESM-first. No runtime `require(...)`.
- Changing a public type or JSON shape requires a changeset.
- New extractor must land with a unit test and at least one fixture.
- Never write API keys into `metrics`, `warnings`, snapshots or logs.

## Quality Gates

- coverage ≥ 80 % · typecheck zero errors · ESLint zero errors · `dist/`
  total ≤ 2 MB.
- E2E (with API key): `overallFieldAccuracy ≥ 0.85`, `p95Ms ≤ 20000`,
  `avgPerFileYuan ≤ 0.05`.

## Don't

- Do not tailor `src/` business logic to a single caller; keep the contract
  provider-neutral.
- Do not commit build products outside `dist/` (and `dist/` is gitignored).
- Do not commit `tests/reports/` — that directory is CI output only.
- Do not touch `specs/001-file-parser/contracts/types.d.ts` without also
  updating `src/types.ts` in the same PR.
