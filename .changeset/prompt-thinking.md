---
'filecrystal': minor
---

Prompt frontmatter now supports a `thinking: true|false` field that opts a
single prompt into or out of provider reasoning mode (e.g. Qwen3
`enable_thinking`). Takes precedence over the env-level default
`FILECRYSTAL_TEXT_MODEL_THINKING`, so you can force-on reasoning for a
complex-extraction prompt while keeping other prompts fast, or force-off
reasoning on a specific prompt even when the env default is on.

Also exposed per-request `extraBody` on `LlmExtractRequest`, merged over
backend-level `extraBody` (request wins), so any provider-specific switch
can be overridden on a per-call basis.
