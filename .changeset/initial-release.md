---
'filecrystal': minor
---

Initial public scaffolding for filecrystal: TypeScript universal file parser
targeting the OpenClaw ecosystem. Ships with a type-safe `ParseResult`
contract, an OpenAI-compatible backend abstraction (default preset 阿里百炼
qwen), SheetJS-driven xlsx/xls extraction, placeholder extractors for PDF /
image / docx (to be filled in during Stages B and C), Mock mode for offline
use, disk cache + metrics plumbing, and a `filecrystal` CLI.
