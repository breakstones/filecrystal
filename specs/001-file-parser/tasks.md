# 001 · filecrystal — Tasks

> Task list for the MVP release. Grouped by stage; check items as you go.
> Conventions:
> `[ ]` pending · `[~]` in-progress · `[x]` done · `[-]` cancelled.

## Stage A · Foundation

- [x] A-01 Scaffolding: `package.json` / `tsconfig.json` / `tsup.config.ts` /
  `eslint.config.js` / `.prettierrc.json` / `vitest.config.ts` →
  `pnpm build` emits `dist/`.
- [x] A-02 `src/types.ts` + `src/schema/` export both the TS contract and a
  JSON Schema via `zod-to-json-schema`.
- [x] A-03 `src/config.ts` validates `FileParserConfig` with zod and merges
  environment variables; mock mode works without API keys.
- [ ] A-04 Decide GitHub organisation / owner; replace `<ORG>` placeholders
  in `package.json`, push to GitHub.
- [x] A-05 `src/extractors/utils/` pure functions (`selectPages`,
  `truncateText`, `sha256File`) with unit tests.

## Stage B · Layer 1 extractors + OpenAI-compatible backends

- [x] B-00 `OcrBackend` interface + OpenAI-compatible implementation; qwen
  preset as default validation provider.
- [x] B-01 `extractors/xlsx.ts` — SheetJS for xls + xlsx (cells, merges,
  formulas). Unit + snapshot.
- [ ] B-02 `extractors/pdf.ts` — pdfjs-dist text-layer branch (no OCR).
- [ ] B-03 `extractors/pdf.ts` — `@napi-rs/canvas` rasterise + OcrBackend
  fallback; validated against 百炼 `qwen-vl-ocr-latest`.
- [ ] B-04 `extractors/docx.ts` — mammoth (docx) + word-extractor (doc);
  embedded-image seal scan.
- [ ] B-05 `extractors/image.ts` — sharp (EXIF rotate, grayscale, long-edge
  resize) → OcrBackend.
- [ ] B-06 `seal/detector.ts` — vision backend, default preset qwen-vl-max,
  optionally merged with OCR in a single call.

## Stage C · Layer 2 + ship

- [x] C-00 `LlmBackend` interface + OpenAI-compatible implementation with
  `response_format: json_object`.
- [x] C-01 `llm/prompt.ts` (frontmatter parsing + user-prompt assembly) +
  `llm/resolve-locator.ts` (locator_hint → SourceLocator).
- [x] C-02 `cache/` with atomic writes and `proper-lockfile`.
- [x] C-03 `metrics/` + `pricing.ts` producing quality / performance / cost.
- [x] C-04 `cli.ts` exposes `extract` and `structure` subcommands.
- [x] C-05 `examples/` with `cli-workflow.sh` (CLI end-to-end),
  `sdk-workflow.mjs` (SDK end-to-end) and `README.md` index.
- [ ] C-06 GitHub Actions: `ci.yml` (Node 18/20/22 × ubuntu/windows) +
  `release.yml` (changesets).
- [ ] C-07 First changeset + `NPM_TOKEN` secret + first `pnpm publish`.

## Ongoing

- [ ] Maintain `specs/001-file-parser/contracts/types.d.ts` in sync with
  `src/types.ts` (diff in PRs).
- [ ] Keep `src/llm/pricing.ts` aligned with provider price sheets.
