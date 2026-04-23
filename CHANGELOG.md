# filecrystal

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
