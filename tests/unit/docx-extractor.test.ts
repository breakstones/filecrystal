import { describe, expect, it } from 'vitest';
import { extractDocx } from '../../src/extractors/docx.js';
import { createMockOcrBackend } from '../../src/mocks/ocr.js';
import { MetricsCollector } from '../../src/metrics/collector.js';
import type { ExtractorContext } from '../../src/extractors/context.js';
import { createLimiter } from '../../src/utils/concurrency.js';
import { FileParserError } from '../../src/utils/errors.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

function makeCtx(): ExtractorContext {
  return {
    ocr: createMockOcrBackend(),
    visionOcr: createMockOcrBackend(),
    truncation: { maxPages: 10, headTailRatio: [7, 3], docxMaxChars: 5000 },
    ocrConfig: { maxConcurrency: 3, timeoutMs: 1000, retries: 0, imageMaxLongEdge: 2000 },
    ocrLimiter: createLimiter(3),
    detectSeals: false,
    fullPages: false,
    metrics: new MetricsCollector(),
  };
}

describe('extractDocx (.doc fallback path)', () => {
  it('throws a FileParserError for an unreadable .doc file', async () => {
    mkdirSync(fixturesDir, { recursive: true });
    const bad = join(fixturesDir, 'bogus.doc');
    writeFileSync(bad, 'not-a-real-doc');
    await expect(extractDocx(bad, makeCtx())).rejects.toBeInstanceOf(FileParserError);
  });
});
