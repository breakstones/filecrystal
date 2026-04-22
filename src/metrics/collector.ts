import type { CallRecord, ParseMetrics } from '../types.js';
import { computeYuan } from '../llm/pricing.js';

export class MetricsCollector {
  private calls: CallRecord[] = [];
  private warnings = 0;
  private extractMs = 0;
  private ocrMs = 0;
  private sealMs = 0;
  private llmMs = 0;
  private ocrConcurrencyPeak = 0;
  private cacheHit = false;

  recordCall(call: CallRecord): void {
    this.calls.push(call);
  }

  addExtractMs(ms: number): void {
    this.extractMs += ms;
  }
  addOcrMs(ms: number): void {
    this.ocrMs += ms;
  }
  addSealMs(ms: number): void {
    this.sealMs += ms;
  }
  addLlmMs(ms: number): void {
    this.llmMs += ms;
  }
  setCacheHit(hit: boolean): void {
    this.cacheHit = hit;
  }
  bumpConcurrencyPeak(v: number): void {
    this.ocrConcurrencyPeak = Math.max(this.ocrConcurrencyPeak, v);
  }
  incWarning(): void {
    this.warnings++;
  }

  build(args: {
    fieldCount: number;
    fieldsAboveConfidence: number;
    avgConfidence: number;
    locatorResolveRate: number;
    ocrCharsRecognized: number;
    sealsDetected: number;
    signaturesDetected: number;
    totalMs: number;
  }): ParseMetrics {
    const callsByModel: ParseMetrics['cost']['callsByModel'] = {};
    let totalYuan = 0;
    for (const c of this.calls) {
      const entry = (callsByModel[c.model] ??= {
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        imageTokens: 0,
        yuan: 0,
      });
      entry.calls++;
      entry.promptTokens += c.promptTokens ?? 0;
      entry.completionTokens += c.completionTokens ?? 0;
      entry.imageTokens = (entry.imageTokens ?? 0) + (c.imageTokens ?? 0);
      const yuan = computeYuan(c.model, {
        promptTokens: c.promptTokens,
        completionTokens: c.completionTokens,
        imageTokens: c.imageTokens,
      });
      entry.yuan += yuan;
      totalYuan += yuan;
    }
    const retries = this.calls.reduce((s, c) => s + (c.retries ?? 0), 0);
    return {
      quality: {
        fieldCount: args.fieldCount,
        fieldsAboveConfidence: args.fieldsAboveConfidence,
        avgConfidence: args.avgConfidence,
        locatorResolveRate: args.locatorResolveRate,
        ocrCharsRecognized: args.ocrCharsRecognized,
        sealsDetected: args.sealsDetected,
        signaturesDetected: args.signaturesDetected,
        warningsCount: this.warnings,
      },
      performance: {
        totalMs: args.totalMs,
        extractMs: this.extractMs,
        ocrMs: this.ocrMs,
        sealMs: this.sealMs,
        llmMs: this.llmMs,
        cacheHit: this.cacheHit,
        ocrConcurrencyPeak: this.ocrConcurrencyPeak,
        retries,
      },
      cost: {
        totalYuan: Math.round(totalYuan * 10000) / 10000,
        callsByModel,
      },
    };
  }
}
