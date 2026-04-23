#!/usr/bin/env node
/**
 * Benchmark filecrystal against the real files in tmp_data/files.
 *
 * Scenario A: parse raw only (no prompt).
 * Scenario B: parse raw + structured fields (with prompt).
 *
 * Required env:
 *   FILECRYSTAL_MODEL_API_KEY     — OpenAI-compatible API key
 *   FILECRYSTAL_MODEL_BASE_URL    — OpenAI-compatible base URL
 *                                    (default: https://dashscope.aliyuncs.com/compatible-mode/v1)
 * Optional env:
 *   FILECRYSTAL_VISION_MODEL   — unified OCR + vision model (default: qwen-vl-ocr-latest)
 *   FILECRYSTAL_TEXT_MODEL     — text/structure model (default: qwen-plus)
 *   FILECRYSTAL_MODE           — 'api' (default) or 'mock' for offline dry runs
 *
 * Usage:
 *   pnpm build
 *   FILECRYSTAL_MODEL_API_KEY=... node scripts/bench-real-files.mjs
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createFileParser } from '../dist/index.js';

const FILES_DIR = 'tmp_data/files';
const PROMPTS_DIR = 'scripts/prompts';
const REPORTS_DIR = 'tests/reports';

const mode = process.env.FILECRYSTAL_MODE ?? 'api';
const apiKey = process.env.FILECRYSTAL_MODEL_API_KEY;
const baseUrl =
  process.env.FILECRYSTAL_MODEL_BASE_URL ??
  'https://dashscope.aliyuncs.com/compatible-mode/v1';

if (mode === 'api' && !apiKey) {
  console.error(
    'FILECRYSTAL_MODEL_API_KEY is required for mode="api" (or set FILECRYSTAL_MODE=mock).',
  );
  process.exit(2);
}

await mkdir(REPORTS_DIR, { recursive: true });

/** @param {string} name */
function pickPromptPath(name) {
  const lower = name.toLowerCase();
  if (lower.includes('合同') || lower.includes('contract')) return 'contract.prompt.md';
  if (lower.includes('账户') || lower.includes('证明') || lower.includes('请款'))
    return 'account-certificate.prompt.md';
  if (
    lower.includes('汇总') ||
    lower.includes('进度款') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.xlsx')
  )
    return 'payment-summary.prompt.md';
  return 'generic.prompt.md';
}

const parserConfig =
  mode === 'api'
    ? {
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
        ocr: { maxConcurrency: 3, timeoutMs: 120_000, retries: 2 },
        extraction: { timeoutMs: 120_000 },
      }
    : { mode: 'mock' };

const parser = createFileParser(parserConfig);

/** @param {string} file @param {import('../dist/index.d.ts').ParseOptions} opts */
async function runOne(file, opts) {
  const t0 = performance.now();
  const res = await parser.parse(file, { force: true, ...opts });
  const wallMs = Math.round(performance.now() - t0);
  return { res, wallMs };
}

const files = (await readdir(FILES_DIR)).filter((name) => !name.startsWith('.'));
console.error(`[bench] mode=${mode} files=${files.length}`);

const byFile = [];
for (const name of files) {
  const full = join(FILES_DIR, name);
  const s = await stat(full);
  const sizeMB = Math.round((s.size / 1024 / 1024) * 1000) / 1000;
  const promptFile = pickPromptPath(name);
  const promptPath = join(PROMPTS_DIR, promptFile);
  const prompt = await readFile(promptPath, 'utf8');

  console.error(`\n[bench] ${name} (${sizeMB} MB) — Scenario A (raw only)`);
  let scenarioA;
  try {
    const { res, wallMs } = await runOne(full, {});
    scenarioA = { ok: true, wallMs, metrics: res.metrics, source: res.source };
  } catch (err) {
    scenarioA = { ok: false, error: String(err?.message ?? err) };
  }

  console.error(`[bench] ${name} — Scenario B (with ${promptFile})`);
  let scenarioB;
  try {
    const { res, wallMs } = await runOne(full, { prompt });
    scenarioB = {
      ok: true,
      wallMs,
      metrics: res.metrics,
      extracted: res.extracted,
    };
  } catch (err) {
    scenarioB = { ok: false, error: String(err?.message ?? err) };
  }

  byFile.push({
    file: name,
    sizeMB,
    format: scenarioA.ok ? scenarioA.source.fileFormat : extname(name).replace('.', ''),
    prompt: promptFile,
    scenarioA,
    scenarioB,
  });
}

/** @param {any} x */
const safe = (x, fallback = 0) => (typeof x === 'number' && !Number.isNaN(x) ? x : fallback);

function pickPerfCells(m) {
  if (!m) return { totalMs: 0, extractMs: 0, ocrMs: 0, sealMs: 0, llmMs: 0, imagesProcessed: 0, yuan: 0 };
  return {
    totalMs: safe(m.metrics?.performance?.totalMs),
    extractMs: safe(m.metrics?.performance?.extractMs),
    ocrMs: safe(m.metrics?.performance?.ocrMs),
    sealMs: safe(m.metrics?.performance?.sealMs),
    llmMs: safe(m.metrics?.performance?.llmMs),
    imagesProcessed: safe(m.metrics?.performance?.imagesProcessed),
    yuan: safe(m.metrics?.cost?.totalYuan),
  };
}

function sum(arr, k) {
  return arr.reduce((s, x) => s + safe(x[k]), 0);
}

function renderRow(prefix, file, perf) {
  return `| ${prefix} | ${file.file} | ${file.sizeMB} | ${perf.totalMs} | ${perf.extractMs} | ${
    perf.ocrMs + perf.sealMs
  } | ${perf.imagesProcessed} | ${perf.llmMs} | ¥${perf.yuan.toFixed(4)} |`;
}

function render(byFile, mode, startedAt) {
  const rowsA = byFile.map((f) => ({ ...pickPerfCells(f.scenarioA), file: f.file, sizeMB: f.sizeMB }));
  const rowsB = byFile.map((f) => ({ ...pickPerfCells(f.scenarioB), file: f.file, sizeMB: f.sizeMB }));
  const sumA = {
    totalMs: sum(rowsA, 'totalMs'),
    extractMs: sum(rowsA, 'extractMs'),
    ocrMs: sum(rowsA, 'ocrMs'),
    sealMs: sum(rowsA, 'sealMs'),
    llmMs: sum(rowsA, 'llmMs'),
    imagesProcessed: sum(rowsA, 'imagesProcessed'),
    yuan: sum(rowsA, 'yuan'),
  };
  const sumB = {
    totalMs: sum(rowsB, 'totalMs'),
    extractMs: sum(rowsB, 'extractMs'),
    ocrMs: sum(rowsB, 'ocrMs'),
    sealMs: sum(rowsB, 'sealMs'),
    llmMs: sum(rowsB, 'llmMs'),
    imagesProcessed: sum(rowsB, 'imagesProcessed'),
    yuan: sum(rowsB, 'yuan'),
  };

  const md = [];
  md.push(`# filecrystal · real-files benchmark (${mode})`);
  md.push('');
  md.push(`- Started at: ${startedAt}`);
  md.push(`- Files: ${byFile.length}`);
  md.push(`- Prompts dir: \`${PROMPTS_DIR}\``);
  md.push('');
  md.push('## Column definitions');
  md.push('- 总耗时 = `metrics.performance.totalMs`');
  md.push('- 原生文档解析耗时 = `extractMs`(xlsx cells / pdf 文本层 / docx 段落)');
  md.push('- 图片解析耗时 = `ocrMs + sealMs`(OCR + 视觉印章检测)');
  md.push('- 图片数量 = `imagesProcessed`(PDF 触发渲染的页数 / 单图 1 / docx 嵌入图)');
  md.push('- 结构化字段解析耗时 = `llmMs`(scenario B only)');
  md.push('');
  md.push('## Scenario A · 仅解析原始文档(无 prompt)');
  md.push('| # | 文件 | 大小MB | 总耗时ms | 原生ms | 图片ms | 图片数 | 字段ms | 成本 |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  rowsA.forEach((f) => md.push(renderRow('A', f, f)));
  md.push(
    `| **合计** | — | — | ${sumA.totalMs} | ${sumA.extractMs} | ${
      sumA.ocrMs + sumA.sealMs
    } | ${sumA.imagesProcessed} | ${sumA.llmMs} | ¥${sumA.yuan.toFixed(4)} |`,
  );
  md.push('');
  md.push('## Scenario B · 解析原始文档 + 结构化字段');
  md.push('| # | 文件 | 大小MB | 总耗时ms | 原生ms | 图片ms | 图片数 | 字段ms | 成本 |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  rowsB.forEach((f) => md.push(renderRow('B', f, f)));
  md.push(
    `| **合计** | — | — | ${sumB.totalMs} | ${sumB.extractMs} | ${
      sumB.ocrMs + sumB.sealMs
    } | ${sumB.imagesProcessed} | ${sumB.llmMs} | ¥${sumB.yuan.toFixed(4)} |`,
  );
  md.push('');
  md.push('## Errors (if any)');
  let hasErrors = false;
  for (const f of byFile) {
    if (!f.scenarioA.ok) {
      hasErrors = true;
      md.push(`- **A** · ${f.file}: ${f.scenarioA.error}`);
    }
    if (!f.scenarioB.ok) {
      hasErrors = true;
      md.push(`- **B** · ${f.file}: ${f.scenarioB.error}`);
    }
  }
  if (!hasErrors) md.push('- (none)');
  md.push('');
  md.push('## Extracted fields (Scenario B)');
  for (const f of byFile) {
    md.push(`### ${f.file}`);
    if (!f.scenarioB.ok) {
      md.push(`- **error:** ${f.scenarioB.error}`);
      continue;
    }
    const ex = f.scenarioB.extracted ?? {};
    const keys = Object.keys(ex);
    if (keys.length === 0) md.push('- (no fields extracted)');
    for (const k of keys) {
      const field = ex[k];
      const locator = field.locator ? JSON.stringify(field.locator) : field.rawHint || '—';
      md.push(
        `- **${k}** · value=\`${JSON.stringify(field.value)}\` · conf=${field.confidence?.toFixed?.(2) ?? field.confidence} · locator=${locator}`,
      );
    }
    md.push('');
  }

  return { md: md.join('\n'), sumA, sumB };
}

const startedAt = new Date().toISOString();
const ts = startedAt.replace(/[:.]/g, '-');
const { md, sumA, sumB } = render(byFile, mode, startedAt);

const jsonPath = join(REPORTS_DIR, `bench-real-files-${ts}.json`);
const mdPath = join(REPORTS_DIR, `bench-real-files-${ts}.md`);
await writeFile(
  jsonPath,
  JSON.stringify({ startedAt, mode, baseUrl: mode === 'api' ? baseUrl : null, byFile, sumA, sumB }, null, 2),
);
await writeFile(mdPath, md);
console.error(`\n[bench] JSON → ${jsonPath}`);
console.error(`[bench] MD   → ${mdPath}`);
console.log(md);
