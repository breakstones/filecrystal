# filecrystal

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
