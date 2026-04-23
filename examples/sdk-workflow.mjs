#!/usr/bin/env node
/**
 * sdk-workflow.mjs — end-to-end filecrystal SDK demo.
 *
 * Usage:
 *   node examples/sdk-workflow.mjs <file> [<file> ...]
 *
 * Required env:
 *   FILECRYSTAL_MODEL_BASE_URL
 *   FILECRYSTAL_MODEL_API_KEY
 *
 * Optional env:
 *   FILECRYSTAL_VISION_MODEL     default: qwen-vl-ocr-latest
 *   FILECRYSTAL_TEXT_MODEL       default: qwen-plus
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  createFileParser,
  createStructuredExtractor,
  parseMany,
  toMarkdown,
  toStructureSource,
} from 'filecrystal';

// --- Read args ---
const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node examples/sdk-workflow.mjs <file> [<file> ...]');
  process.exit(1);
}

// --- Build config (env-driven; SDK mirrors the CLI defaults) ---
const baseUrl = process.env.FILECRYSTAL_MODEL_BASE_URL;
const apiKey = process.env.FILECRYSTAL_MODEL_API_KEY;
if (!baseUrl || !apiKey) {
  console.error('FILECRYSTAL_MODEL_BASE_URL and FILECRYSTAL_MODEL_API_KEY are required.');
  process.exit(2);
}
const config = {
  mode: 'api',
  openai: {
    baseUrl,
    apiKey,
    models: {
      ocr: process.env.FILECRYSTAL_VISION_MODEL ?? 'qwen-vl-ocr-latest',
      vision: process.env.FILECRYSTAL_VISION_MODEL ?? 'qwen-vl-max',
      text: process.env.FILECRYSTAL_TEXT_MODEL ?? 'qwen-plus',
    },
  },
};

// --- Stage 1: parse all files concurrently ---
console.log(`[stage 1] extracting ${paths.length} file(s)...`);
const parser = createFileParser(config);
const batch = await parseMany(parser, paths, { concurrency: Math.min(paths.length, 10) });

const outDir = '.filecrystal-out';
await mkdir(outDir, { recursive: true });

const sources = [];
for (const item of batch.items) {
  if (!item.ok) {
    console.error(`  ✗ ${item.path}  (${item.error})`);
    continue;
  }
  // Save Markdown next to the input (for human review)
  const stem = basename(item.path).replace(new RegExp(`${escapeRe(extname(item.path))}$`), '');
  const mdPath = join(outDir, `${stem}.md`);
  await writeFile(mdPath, toMarkdown(item.result), 'utf8');
  console.log(`  ✓ ${item.path} → ${mdPath} (${item.durationMs} ms)`);
  sources.push(toStructureSource(item.result));
}

if (sources.length === 0) {
  console.error('No files parsed successfully.');
  process.exit(3);
}

// --- Stage 2: structured field extraction (single LLM call, merges all sources) ---
console.log(`\n[stage 2] extracting fields with prompt...`);

// Either load a prompt file...
const promptPath = process.env.PROMPT_FILE ?? 'scripts/prompts/generic.prompt.md';
const prompt = await readFile(promptPath, 'utf8');

// ...or pass a string inline:
// const prompt = `---
// name: inline
// ---
// 你是抽取助手。输出 JSON: {"title":"...", "summary":"..."}
// `;

const extractor = createStructuredExtractor(config);
const result = await extractor.extract(sources, { prompt });

console.log(`  llm ms: ${result.totalLlmMs}  ·  prompt tokens: ${result.tokenUsage.prompt}  ·  completion: ${result.tokenUsage.completion}`);
if (result.warnings.length > 0) {
  console.log(`  warnings: ${result.warnings.join(' | ')}`);
}

// --- Handle the JSON-fix fallback ---
// If the model's output couldn't be parsed as JSON even after repair, the
// `extracted` object has a single `text` key holding the raw model reply.
if (result.extracted && typeof result.extracted.text === 'string' && Object.keys(result.extracted).length === 1) {
  console.log('\n[warning] model returned non-JSON content — raw text below:\n');
  console.log(result.extracted.text);
} else {
  console.log('\n[extracted]');
  console.log(JSON.stringify(result.extracted, null, 2));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
