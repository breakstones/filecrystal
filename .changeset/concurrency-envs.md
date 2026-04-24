---
"filecrystal": minor
---

Add two environment variables for tuning concurrency, with more
aggressive defaults suited to production workloads.

**`FILECRYSTAL_FILE_CONCURRENCY`** — CLI file-level parallelism for
`extract` and `structure` (when raw files are involved). Overridden by
the CLI `--concurrency` flag; otherwise the default is
`min(<files>, 20)`. Both commands now share this default:

- `extract --concurrency` default: `min(<files>, 10)` → **`min(<files>, 20)`**.
- `structure --concurrency` default: `3` → **`min(<raw files>, 20)`**.

**`FILECRYSTAL_OCR_CONCURRENCY`** — process-scoped OCR / vision
parallelism (every page from every file competes for this pool).
Overridden by `FileParserConfig.ocr.maxConcurrency`. Default raised
from **`18` → `24`**.

### When to tune

- Hitting DashScope `429` / rate limit on OCR → set
  `FILECRYSTAL_OCR_CONCURRENCY=8` (or lower).
- Higher quota / multi-account aggregation → raise
  `FILECRYSTAL_OCR_CONCURRENCY=32` and optionally
  `FILECRYSTAL_FILE_CONCURRENCY=40`.
- Pair with `UV_THREADPOOL_SIZE=16` to give `sharp` / `@napi-rs/canvas`
  more native threads during image preprocessing.

Invalid or non-positive env values are silently ignored (fall back to
the defaults) so a stray `0` never aborts a batch.

No public API or CLI-flag changes. Callers happy with the old values
can pin them explicitly via `FILECRYSTAL_FILE_CONCURRENCY=10` and
`FILECRYSTAL_OCR_CONCURRENCY=18`.
