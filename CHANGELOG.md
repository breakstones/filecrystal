# filecrystal

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
