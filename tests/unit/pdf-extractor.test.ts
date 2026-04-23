import { describe, expect, it, beforeAll } from 'vitest';
import { join } from 'node:path';
import { extractPdf } from '../../src/extractors/pdf.js';
import { createMockOcrBackend } from '../../src/mocks/ocr.js';
import { MetricsCollector } from '../../src/metrics/collector.js';
import type { ExtractorContext } from '../../src/extractors/context.js';
import type { OcrBackend, OcrRequest, OcrResult } from '../../src/ocr/backend.js';
import { createLimiter } from '../../src/utils/concurrency.js';
import { buildTextPdf, buildBlankPdf, buildLongPdf, ensureDir, fixturesDir } from '../helpers/fixtures.js';

function ctxWithOcr(ocr: OcrBackend, detectSeals = false, fullPages = false): ExtractorContext {
  return {
    ocr,
    visionOcr: ocr,
    truncation: { maxPages: 10, headTailRatio: [7, 3], docxMaxChars: 5000 },
    ocrConfig: { maxConcurrency: 2, timeoutMs: 1000, retries: 0, imageMaxLongEdge: 2000 },
    ocrLimiter: createLimiter(2),
    detectSeals,
    fullPages,
    metrics: new MetricsCollector(),
  };
}

beforeAll(async () => {
  ensureDir();
  await buildTextPdf(join(fixturesDir, 'text.pdf'));
  await buildBlankPdf(join(fixturesDir, 'blank.pdf'));
  await buildLongPdf(join(fixturesDir, 'long.pdf'), 15);
});

describe('extractPdf · text-layer path', () => {
  it('reads text from a 3-page PDF without calling OCR', async () => {
    let ocrCalls = 0;
    const spy: OcrBackend = {
      async recognize(_req: OcrRequest): Promise<OcrResult> {
        ocrCalls++;
        return { text: 'SHOULD-NOT-BE-USED', blocks: [], model: 'spy', ms: 0 };
      },
    };
    const result = await extractPdf(join(fixturesDir, 'text.pdf'), ctxWithOcr(spy, false));
    expect(result.pageCount).toBe(3);
    expect(result.pagesIncluded).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
    expect(result.raw.pages).toHaveLength(3);
    expect(result.raw.pages![0]!.text).toContain('Hello world');
    expect(result.raw.pages![1]!.text).toContain('500000');
    expect(result.raw.fullText).toContain('Page 2');
    expect(ocrCalls).toBe(0);
  });
});

describe('extractPdf · OCR fallback path', () => {
  it('falls back to OCR when the text layer is empty', async () => {
    const calls: OcrRequest[] = [];
    const stub: OcrBackend = {
      async recognize(req: OcrRequest): Promise<OcrResult> {
        calls.push(req);
        return {
          text: `ocr-page-${req.pageNoHint}`,
          blocks: [
            { blockId: 'b-1', text: `ocr-page-${req.pageNoHint}`, bbox: [0, 0, 1, 1] },
          ],
          model: 'mock-vision',
          ms: 1,
        };
      },
    };
    const result = await extractPdf(join(fixturesDir, 'blank.pdf'), ctxWithOcr(stub, false));
    expect(result.pageCount).toBe(2);
    expect(calls).toHaveLength(2);
    expect(result.raw.pages![0]!.text).toBe('ocr-page-1');
    expect(result.raw.pages![1]!.blocks?.[0]?.blockId).toMatch(/^p2-/);
  });
});

describe('extractPdf · head-tail truncation', () => {
  it('keeps only selected pages when totalPages > maxPages', async () => {
    const result = await extractPdf(join(fixturesDir, 'long.pdf'), ctxWithOcr(createMockOcrBackend()));
    expect(result.pageCount).toBe(15);
    expect(result.truncated).toBe(true);
    expect(result.pagesIncluded).toEqual([1, 2, 3, 4, 5, 6, 7, 13, 14, 15]);
    expect(result.raw.pages).toHaveLength(10);
  });

  it('respects fullPages=true', async () => {
    const result = await extractPdf(
      join(fixturesDir, 'long.pdf'),
      ctxWithOcr(createMockOcrBackend(), false, true),
    );
    expect(result.truncated).toBe(false);
    expect(result.pagesIncluded).toHaveLength(15);
  });
});
