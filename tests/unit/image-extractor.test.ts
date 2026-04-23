import { describe, expect, it, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { extractImage } from '../../src/extractors/image.js';
import { createMockOcrBackend } from '../../src/mocks/ocr.js';
import { MetricsCollector } from '../../src/metrics/collector.js';
import type { ExtractorContext } from '../../src/extractors/context.js';
import { createLimiter } from '../../src/utils/concurrency.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');
const fixturePath = join(fixturesDir, 'sample.png');

beforeAll(async () => {
  mkdirSync(fixturesDir, { recursive: true });
  const buf = await sharp({
    create: { width: 64, height: 32, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  writeFileSync(fixturePath, buf);
});

describe('extractImage', () => {
  it('preprocesses with sharp and calls the OCR backend', async () => {
    const metrics = new MetricsCollector();
    const ctx: ExtractorContext = {
      ocr: createMockOcrBackend(),
      visionOcr: createMockOcrBackend(),
      truncation: { maxPages: 10, headTailRatio: [7, 3], docxMaxChars: 5000 },
      ocrConfig: {
        maxConcurrency: 3,
        timeoutMs: 1000,
        retries: 0,
        imageMaxLongEdge: 2000,
      },
      ocrLimiter: createLimiter(3),
      detectSeals: false,
      fullPages: false,
      metrics,
    };
    const result = await extractImage(fixturePath, ctx);
    expect(result.raw.pages?.[0]?.pageNo).toBe(1);
    expect(result.raw.pages?.[0]?.text).toContain('mock-ocr');
    expect(result.raw.fullText).toContain('mock-ocr');
  });
});
