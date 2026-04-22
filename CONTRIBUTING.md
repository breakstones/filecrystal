# Contributing to filecrystal

Thanks for your interest! filecrystal is a spec-driven project — big changes
start with a short spec edit, small changes start with a test.

## Quickstart

```bash
pnpm install
pnpm build
pnpm test
```

## Workflow

1. Read `specs/001-file-parser/spec.md` and `plan.md` to understand scope.
2. Find or add an item in `specs/001-file-parser/tasks.md`. Mark it `[~]`
   while you work on it.
3. Open a branch, commit, push, open a PR.
4. Every PR that changes public API / JSON shape **must** include a
   `changeset` entry: `pnpm changeset`.
5. CI must pass: lint + typecheck + tests + build.

## Changeset conventions

- `patch`: internal-only fix, no API change, no JSON-shape change.
- `minor`: additive changes (new extractor, new config field, new metric).
- `major`: breaking changes (renamed fields, removed method). Requires a
  bump of `SCHEMA_VERSION` if the wire shape changes.

## Coding guidelines

- ESM-first. No dynamic `require(...)`.
- All I/O goes through the abstractions (`OcrBackend`, `LlmBackend`,
  `CacheStore`, `MetricsCollector`). Write unit tests with mocks and e2e
  tests with real providers.
- Every new extractor lands with:
  - a unit test that parses a tiny fixture (< 50 KB, committed),
  - an entry in `tasks.md` checked off,
  - optional e2e snapshot under `tests/snapshots/`.
- Never log or store API keys. Review diffs for accidental leaks before
  opening a PR.

## Adding a new OpenAI-compatible provider

Copy an existing preset under `src/ocr/presets/` or `src/llm/presets/` and
wire sensible defaults. The generic implementation in
`src/ocr/openai-compat.ts` / `src/llm/openai-compat.ts` already handles the
hot path; your preset just fills in `baseUrl` and default `model`.

## Releasing

CI handles it. When `changesets/action@v1` opens a "Version Packages" PR,
merge it; the subsequent push to `main` publishes to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements).
