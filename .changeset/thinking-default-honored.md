---
"filecrystal": patch
---

Fix: `enableThinking` is now honoured on every LLM/OCR request, not just
when opted in to `true`.

Previously the backend/request code would *omit* the `enable_thinking`
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
