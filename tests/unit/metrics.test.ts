import { describe, expect, it } from 'vitest';
import { MetricsCollector } from '../../src/metrics/collector.js';

describe('MetricsCollector', () => {
  it('aggregates call records into cost and callsByModel', () => {
    const m = new MetricsCollector();
    m.addOcrMs(120);
    m.addLlmMs(90);
    m.addExtractMs(30);
    m.addSealMs(10);
    m.bumpConcurrencyPeak(3);
    m.setCacheHit(false);
    m.incWarning();
    m.incImagesProcessed(4);
    m.incImagesProcessed();

    m.recordCall({
      model: 'qwen-plus',
      provider: 'dashscope',
      promptTokens: 10000,
      completionTokens: 2000,
      ms: 50,
      success: true,
      retries: 1,
    });
    m.recordCall({
      model: 'qwen-vl-ocr-latest',
      provider: 'dashscope',
      promptTokens: 5000,
      completionTokens: 500,
      imageTokens: 3000,
      ms: 30,
      success: true,
    });

    const out = m.build({
      fieldCount: 3,
      fieldsAboveConfidence: 2,
      avgConfidence: 0.8,
      locatorResolveRate: 2 / 3,
      ocrCharsRecognized: 500,
      sealsDetected: 1,
      signaturesDetected: 2,
      totalMs: 250,
    });

    expect(out.quality.fieldCount).toBe(3);
    expect(out.quality.warningsCount).toBe(1);
    expect(out.performance.totalMs).toBe(250);
    expect(out.performance.ocrConcurrencyPeak).toBe(3);
    expect(out.performance.retries).toBe(1);
    expect(out.performance.imagesProcessed).toBe(5);
    expect(out.cost.totalYuan).toBeGreaterThan(0);
    expect(out.cost.callsByModel['qwen-plus']!.calls).toBe(1);
    expect(out.cost.callsByModel['qwen-vl-ocr-latest']!.imageTokens).toBe(3000);
  });
});
