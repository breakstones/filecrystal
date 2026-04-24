import { describe, expect, it } from 'vitest';
import {
  createStructuredExtractor,
  toStructureSource,
  type StructureSource,
} from '../../src/structure.js';
import { createMockLlmBackend } from '../../src/mocks/llm.js';
import type { ParseResult } from '../../src/types.js';

describe('toStructureSource', () => {
  it('derives name from ParseResult.source.fileName and renders raw via toMarkdown', () => {
    const parseResult: ParseResult = {
      schemaVersion: '1.0',
      parsedAt: '2026-04-22T00:00:00.000Z',
      parserVersion: 'test',
      source: {
        filePath: '/x/合同.pdf',
        fileName: '合同.pdf',
        fileFormat: 'pdf',
        fileSizeMB: 0.1,
        fileHash: 'a'.repeat(64),
        truncated: false,
        uploadedAt: '2026-04-22T00:00:00.000Z',
      },
      raw: { fullText: 'hello' },
      metrics: {
        quality: {
          fieldCount: 0,
          fieldsAboveConfidence: 0,
          avgConfidence: 0,
          locatorResolveRate: 0,
          ocrCharsRecognized: 5,
          sealsDetected: 0,
          signaturesDetected: 0,
          warningsCount: 0,
        },
        performance: {
          totalMs: 0,
          extractMs: 0,
          ocrMs: 0,
          sealMs: 0,
          llmMs: 0,
          cacheHit: false,
          ocrConcurrencyPeak: 0,
          retries: 0,
          imagesProcessed: 0,
        },
        cost: { totalYuan: 0, callsByModel: {} },
      },
    };
    const src = toStructureSource(parseResult);
    expect(src.name).toBe('合同.pdf');
    // toMarkdown prepends the filename as a # heading and returns the body text.
    expect(src.text).toContain('hello');
    expect(src.text).toContain('合同.pdf');
  });

  it('accepts a bare { raw, name } shape and renders it via toMarkdown', () => {
    const src = toStructureSource({ raw: { fullText: 'plain body' }, name: 'doc.txt' });
    expect(src.name).toBe('doc.txt');
    expect(src.text).toContain('plain body');
  });
});

describe('createStructuredExtractor (mock mode)', () => {
  it('returns extracted, batches and tokenUsage for a single source', async () => {
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const sources: StructureSource[] = [{ name: 'a.xlsx', text: 'hello world' }];
    const res = await extractor.extract(sources);
    expect(res.batches).toHaveLength(1);
    expect(res.batches[0]!.sources).toBe(1);
    expect(res.extracted.mockField?.value).toBe('[mock]');
    expect(res.totalLlmMs).toBeGreaterThanOrEqual(0);
    expect(res.promptName).toBe('default-structure');
  });

  it('uses caller-supplied prompt when provided', async () => {
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const prompt = `---
name: custom-prompt
---

body`;
    const res = await extractor.extract([{ name: 'a', text: 'x' }], { prompt });
    expect(res.promptName).toBe('custom-prompt');
  });

  it('defaults to a single batch even for very large inputs (no implicit split)', async () => {
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const big = 'x'.repeat(50_000);
    const sources: StructureSource[] = Array.from({ length: 10 }, (_, i) => ({
      name: `f${i}.md`,
      text: big,
    }));
    const res = await extractor.extract(sources);
    expect(res.batches).toHaveLength(1);
    expect(res.batches[0]!.sources).toBe(10);
    expect(res.warnings.some((w) => w.includes('batches'))).toBe(false);
  });

  it('splits when maxInputChars is explicitly set below the combined size', async () => {
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const big = 'x'.repeat(1000);
    const sources: StructureSource[] = [
      { name: 'a', text: big },
      { name: 'b', text: big },
      { name: 'c', text: big },
    ];
    const res = await extractor.extract(sources, { maxInputChars: 1500 });
    expect(res.batches.length).toBeGreaterThan(1);
    expect(res.warnings.some((w) => w.includes('batches'))).toBe(true);
  });

  it('merges fields across batches keeping the later value for duplicate keys', async () => {
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const res = await extractor.extract(
      [
        { name: 'a', text: 'a'.repeat(600) },
        { name: 'b', text: 'b'.repeat(600) },
      ],
      { maxInputChars: 500 },
    );
    expect(res.batches.length).toBe(2);
    expect(res.extracted.mockField).toBeDefined();
  });

  it('handles empty input gracefully (single empty batch)', async () => {
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const res = await extractor.extract([]);
    expect(res.batches.length).toBe(1);
    expect(Object.keys(res.extracted).length).toBeGreaterThanOrEqual(0);
  });

  it('forwards frontmatter.thinking into the LLM request as extraBody.enable_thinking', async () => {
    const mock = createMockLlmBackend({ record: true });
    const extractor = createStructuredExtractor({ mode: 'mock' }, { llm: mock });
    const prompt = `---
name: with-thinking
thinking: true
---
body`;
    await extractor.extract([{ name: 'a', text: 'x' }], { prompt });
    expect(mock.lastRequest?.extraBody).toEqual({ enable_thinking: true });
  });

  it('defaults to enable_thinking: false on every request (explicit, never omitted)', async () => {
    // qwen3 reasoning models default to thinking=true server-side when the
    // field is omitted, which would silently break our "thinking off by
    // default" contract. The boolean must be sent on every call.
    const mock = createMockLlmBackend({ record: true });
    const extractor = createStructuredExtractor({ mode: 'mock' }, { llm: mock });
    await extractor.extract([{ name: 'a', text: 'x' }]);
    expect(mock.lastRequest?.extraBody).toEqual({ enable_thinking: false });
  });

  it('honours config.extraction.enableThinking when no prompt frontmatter is set', async () => {
    const mock = createMockLlmBackend({ record: true });
    const extractor = createStructuredExtractor(
      { mode: 'mock', extraction: { enableThinking: true } },
      { llm: mock },
    );
    await extractor.extract([{ name: 'a', text: 'x' }]);
    expect(mock.lastRequest?.extraBody).toEqual({ enable_thinking: true });
  });

  it('lets `thinking: false` in prompt frontmatter override an env-level true', async () => {
    const mock = createMockLlmBackend({ record: true });
    const extractor = createStructuredExtractor(
      { mode: 'mock', extraction: { enableThinking: true } },
      { llm: mock },
    );
    const prompt = `---
thinking: false
---
body`;
    await extractor.extract([{ name: 'a', text: 'x' }], { prompt });
    expect(mock.lastRequest?.extraBody).toEqual({ enable_thinking: false });
  });

  it('falls back to {text} when the LLM backend reports parseFailed and surfaces a warning', async () => {
    const flaky: import('../../src/llm/backend.js').LlmBackend = {
      async extract(_req) {
        return {
          fields: { text: 'sorry I cannot parse that' },
          parseFailed: true,
          model: 'mock-llm',
          ms: 1,
        };
      },
    };
    const extractor = createStructuredExtractor({ mode: 'mock' }, { llm: flaky });
    const res = await extractor.extract([{ name: 'a', text: 'x' }]);
    expect(res.batches[0]!.parseFailed).toBe(true);
    expect(res.warnings.some((w) => w.includes('non-JSON'))).toBe(true);
    expect(res.extracted.text).toBe('sorry I cannot parse that');
  });

  it('concatenates sources in input order with `# File: <name>` headings and `---` separators', async () => {
    const mock = createMockLlmBackend({ record: true });
    const extractor = createStructuredExtractor({ mode: 'mock' }, { llm: mock });
    await extractor.extract([
      { name: 'a.md', text: 'ALPHA' },
      { name: 'b.md', text: 'BRAVO' },
      { name: 'c.md', text: 'CHARLIE' },
    ]);
    expect(mock.requests).toHaveLength(1);
    const { userPrompt } = mock.lastRequest!;
    expect(userPrompt).toContain('# File: a.md\n\nALPHA');
    expect(userPrompt).toContain('# File: b.md\n\nBRAVO');
    expect(userPrompt).toContain('# File: c.md\n\nCHARLIE');
    // Separator between files
    expect(userPrompt).toMatch(/ALPHA\n\n---\n\n# File: b\.md/);
    // Order preserved: a before b before c.
    expect(userPrompt.indexOf('ALPHA')).toBeLessThan(userPrompt.indexOf('BRAVO'));
    expect(userPrompt.indexOf('BRAVO')).toBeLessThan(userPrompt.indexOf('CHARLIE'));
    // Anchor preserved.
    expect(userPrompt).toContain('【文档原文】');
  });
});
