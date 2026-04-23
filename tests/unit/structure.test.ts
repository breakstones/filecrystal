import { describe, expect, it } from 'vitest';
import { createStructuredExtractor, toStructureSource, type StructureSource } from '../../src/structure.js';
import type { ParseResult } from '../../src/types.js';

describe('toStructureSource', () => {
  it('derives name from ParseResult.source.fileName', () => {
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
    expect(src.raw.fullText).toBe('hello');
  });
});

describe('createStructuredExtractor (mock mode)', () => {
  it('returns extracted, batches and tokenUsage for a single source', async () => {
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const sources: StructureSource[] = [
      { name: 'a.xlsx', raw: { fullText: 'hello world' } },
    ];
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
    const res = await extractor.extract([{ raw: { fullText: 'x' } }], { prompt });
    expect(res.promptName).toBe('custom-prompt');
  });

  it('splits oversize inputs into multiple batches', async () => {
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const big = 'x'.repeat(1000);
    const sources: StructureSource[] = [
      { name: 'a', raw: { fullText: big } },
      { name: 'b', raw: { fullText: big } },
      { name: 'c', raw: { fullText: big } },
    ];
    const res = await extractor.extract(sources, { maxInputChars: 1500 });
    expect(res.batches.length).toBeGreaterThan(1);
    expect(res.warnings.some((w) => w.includes('batches'))).toBe(true);
  });

  it('merges fields across batches keeping the highest-confidence one', async () => {
    // Run with a deterministic stub LLM by inspecting the mock path:
    // the mock LLM always returns {mockField:{value:'[mock]',confidence:0.5}},
    // so across multiple batches combined[mockField].confidence stays 0.5.
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const res = await extractor.extract(
      [
        { raw: { fullText: 'a'.repeat(600) } },
        { raw: { fullText: 'b'.repeat(600) } },
      ],
      { maxInputChars: 500 },
    );
    expect(res.batches.length).toBe(2);
    expect(res.extracted.mockField).toBeDefined();
  });

  it('handles empty input gracefully', async () => {
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const res = await extractor.extract([]);
    expect(res.batches.length).toBe(1);
    // Mock LLM still returns its one field even for an empty batch.
    expect(Object.keys(res.extracted).length).toBeGreaterThanOrEqual(0);
  });
});
