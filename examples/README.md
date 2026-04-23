# filecrystal examples

Two integration surfaces, one package. Pick either — they produce the same
output shape.

| Surface | When to use | Entry |
|---|---|---|
| **CLI** | shell scripts · batch jobs · CI pipelines · language-agnostic integrations | [`cli-workflow.sh`](./cli-workflow.sh) |
| **SDK** | Node.js apps · custom pre/post-processing · tight error handling | [`sdk-workflow.mjs`](./sdk-workflow.mjs) |

Both examples walk through the same two-stage pipeline:

```
extract  (files → Markdown)        structure  (Markdown → prompt-defined JSON)
```

## Prerequisites

Set API credentials once:

```bash
export FILECRYSTAL_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export FILECRYSTAL_MODEL_API_KEY=sk-your-key-here
```

Swap `baseUrl` + model names for OpenAI / Moonshot / DeepSeek / vLLM — no
other code changes.

## CLI quickstart

```bash
./examples/cli-workflow.sh ./docs/contract.pdf ./docs/invoice.xlsx
```

Does two things:
1. `filecrystal extract <files>` → writes `<name>.md` next to each input
2. `filecrystal structure *.md --prompt ...` → prints the LLM-extracted JSON

Full CLI reference: [`docs/CLI.md`](../docs/CLI.md).

## SDK quickstart

```bash
node examples/sdk-workflow.mjs ./docs/contract.pdf ./docs/invoice.xlsx
```

Does the same flow programmatically, showing:
- `createFileParser` + `parseMany` for concurrent batch parsing
- `toMarkdown` for the Markdown rendering
- `createStructuredExtractor` for prompt-driven field extraction
- How to handle `extracted: { text: "..." }` fallback when the model's output
  isn't valid JSON

## Custom prompts

Both examples accept a prompt file; see [`scripts/prompts/`](../scripts/prompts/)
for ready-to-use samples (contract / payment summary / account certificate /
generic) or write your own in Markdown + YAML frontmatter.
