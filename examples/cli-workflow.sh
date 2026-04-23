#!/usr/bin/env bash
# cli-workflow.sh — end-to-end filecrystal CLI demo.
#
# Usage:
#   ./examples/cli-workflow.sh <file> [<file> ...]
#
# Required env:
#   FILECRYSTAL_MODEL_BASE_URL   e.g. https://dashscope.aliyuncs.com/compatible-mode/v1
#   FILECRYSTAL_MODEL_API_KEY    your API key
#
# Optional env:
#   FILECRYSTAL_VISION_MODEL     OCR model (default: qwen-vl-ocr-latest)
#   FILECRYSTAL_TEXT_MODEL       structure model (default: qwen-plus)

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <file> [<file> ...]" >&2
  exit 1
fi

if [ -z "${FILECRYSTAL_MODEL_API_KEY:-}" ]; then
  echo "FILECRYSTAL_MODEL_API_KEY is required." >&2
  exit 2
fi

OUT_DIR="${OUT_DIR:-./.filecrystal-out}"
PROMPT_FILE="${PROMPT_FILE:-scripts/prompts/generic.prompt.md}"

mkdir -p "$OUT_DIR"

echo "=== Step 1 · extract → Markdown ==="
# Writes <name>.md for every input into $OUT_DIR.
filecrystal extract "$@" --out "$OUT_DIR"

echo ""
echo "=== Step 2 · structure → JSON (using $PROMPT_FILE) ==="
# Feed all .md back into the structure stage; one LLM call per batch.
filecrystal structure "$OUT_DIR"/*.md --prompt "$PROMPT_FILE"

echo ""
echo "Done. Markdown in $OUT_DIR/, JSON printed above."
