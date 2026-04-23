import { describe, expect, it, beforeAll } from 'vitest';
import { join } from 'node:path';
import { extractDocx } from '../../src/extractors/docx.js';
import { createMockOcrBackend } from '../../src/mocks/ocr.js';
import { MetricsCollector } from '../../src/metrics/collector.js';
import type { ExtractorContext } from '../../src/extractors/context.js';
import { createLimiter } from '../../src/utils/concurrency.js';
import { buildDocx, ensureDir, fixturesDir } from '../helpers/fixtures.js';

function ctx(): ExtractorContext {
  return {
    ocr: createMockOcrBackend(),
    visionOcr: createMockOcrBackend(),
    truncation: { maxPages: 10, headTailRatio: [7, 3], docxMaxChars: 5000 },
    ocrConfig: { maxConcurrency: 2, timeoutMs: 1000, retries: 0, imageMaxLongEdge: 2000 },
    ocrLimiter: createLimiter(2),
    detectSeals: false,
    fullPages: false,
    metrics: new MetricsCollector(),
  };
}

beforeAll(async () => {
  ensureDir();
  await buildDocx(join(fixturesDir, 'simple.docx'), [
    'Alpha paragraph with hello world.',
    'Beta paragraph carries amount 12345.',
    'Gamma paragraph last line.',
  ]);
  await buildDocx(
    join(fixturesDir, 'long.docx'),
    Array.from({ length: 100 }, (_, i) => `paragraph ${i + 1} with some text content that adds up.`),
  );
});

describe('extractDocx · happy path', () => {
  it('extracts paragraphs from a .docx as p-n sections', async () => {
    const result = await extractDocx(join(fixturesDir, 'simple.docx'), ctx());
    expect(result.raw.sections).toBeDefined();
    expect(result.raw.sections!.length).toBe(3);
    expect(result.raw.sections![0]!.sectionId).toBe('p-1');
    expect(result.raw.sections![0]!.text).toContain('Alpha');
    expect(result.raw.sections![1]!.text).toContain('12345');
    expect(result.raw.fullText).toContain('Gamma');
    expect(result.truncated).toBe(false);
  });
});

describe('extractDocx · long docs get head+tail truncated', () => {
  it('flags truncated=true when original > docxMaxChars', async () => {
    const result = await extractDocx(join(fixturesDir, 'long.docx'), ctx());
    expect(result.truncated).toBe(true);
    expect(result.raw.fullText!.length).toBeLessThan(10_000);
  });
});
