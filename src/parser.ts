import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import type {
  FileParser,
  FileParserConfig,
  ParseOptions,
  ParseResult,
  ParsedRaw,
  ParsedSource,
} from './types.js';
import { SCHEMA_VERSION } from './types.js';
import { resolveConfig, type ResolvedConfig } from './config.js';
import { detectFormat } from './extractors/index.js';
import { extractXlsx } from './extractors/xlsx.js';
import { extractPdf } from './extractors/pdf.js';
import { extractDocx } from './extractors/docx.js';
import { extractImage } from './extractors/image.js';
import type { ExtractorContext } from './extractors/context.js';
import { sha256File } from './extractors/utils/file-hash.js';
import { MetricsCollector } from './metrics/collector.js';
import { createMockLlmBackend } from './mocks/llm.js';
import { createMockOcrBackend } from './mocks/ocr.js';
import type { LlmBackend } from './llm/backend.js';
import type { OcrBackend } from './ocr/backend.js';
import { createOpenAICompatLlmBackend } from './llm/openai-compat.js';
import { createOpenAICompatOcrBackend } from './ocr/openai-compat.js';
import { parsePromptFile, buildUserPrompt } from './llm/prompt.js';
import { createFileCacheStore, type CacheStore } from './cache/store.js';
import { buildCacheKey, fingerprintConfig } from './cache/key.js';
import { FileParserError, ErrorCode } from './utils/errors.js';
import { sha256String } from './extractors/utils/file-hash.js';
import { createLimiter, type Limiter } from './utils/concurrency.js';

class FileParserImpl implements FileParser {
  private readonly cfg: ResolvedConfig;
  private readonly ocr: OcrBackend;
  private readonly visionOcr: OcrBackend;
  private readonly llm: LlmBackend;
  private readonly cache: CacheStore;
  private readonly configFingerprint: string;
  private readonly ocrLimiter: Limiter;

  constructor(cfg: ResolvedConfig) {
    this.cfg = cfg;
    if (cfg.mode === 'mock' || !cfg.openai) {
      this.ocr = createMockOcrBackend();
      this.visionOcr = createMockOcrBackend();
      this.llm = createMockLlmBackend();
    } else {
      const visionExtraBody = cfg.ocr.enableThinking ? { enable_thinking: true } : undefined;
      const textExtraBody = cfg.extraction.enableThinking ? { enable_thinking: true } : undefined;
      this.ocr = createOpenAICompatOcrBackend({
        baseUrl: cfg.openai.baseUrl,
        apiKey: cfg.openai.apiKey,
        model: cfg.openai.models.ocr,
        timeoutMs: cfg.ocr.timeoutMs,
        retries: cfg.ocr.retries,
        ...(visionExtraBody ? { extraBody: visionExtraBody } : {}),
      });
      this.visionOcr = createOpenAICompatOcrBackend({
        baseUrl: cfg.openai.baseUrl,
        apiKey: cfg.openai.apiKey,
        model: cfg.openai.models.vision,
        timeoutMs: cfg.ocr.timeoutMs,
        retries: cfg.ocr.retries,
        ...(visionExtraBody ? { extraBody: visionExtraBody } : {}),
      });
      this.llm = createOpenAICompatLlmBackend({
        baseUrl: cfg.openai.baseUrl,
        apiKey: cfg.openai.apiKey,
        model: cfg.openai.models.text,
        timeoutMs: cfg.extraction.timeoutMs,
        ...(textExtraBody ? { extraBody: textExtraBody } : {}),
      });
    }
    this.cache = createFileCacheStore(cfg.cacheDir);
    // Process-scoped OCR/vision limiter shared across every extractor call
    // that flows through this parser instance — pages from different files
    // all compete for the same pool, so a 1-page file can't leave slots idle
    // while a 10-page file waits.
    this.ocrLimiter = createLimiter(cfg.ocr.maxConcurrency);
    this.configFingerprint = fingerprintConfig({
      mode: cfg.mode,
      parserVersion: cfg.parserVersion,
      ocrModel: cfg.openai?.models.ocr,
      visionModel: cfg.openai?.models.vision,
      textModel: cfg.openai?.models.text,
      truncation: cfg.truncation,
      sealEnabled: cfg.seal.enabled,
    });
  }

  async parse(filePath: string, options: ParseOptions = {}): Promise<ParseResult> {
    const metrics = new MetricsCollector();
    const warnings: string[] = [];
    const start = Date.now();

    const format = detectFormat(filePath);
    let stats;
    let fileHash: string;
    try {
      // stat + content hash are independent; run concurrently.
      [stats, fileHash] = await Promise.all([stat(filePath), sha256File(filePath)]);
    } catch (err) {
      throw new FileParserError(ErrorCode.FILE_NOT_FOUND, `Cannot stat file: ${filePath}`, {
        cause: String(err),
      });
    }

    const promptHash = options.prompt ? sha256String(options.prompt).slice(0, 12) : undefined;
    const cacheKey = buildCacheKey(fileHash, this.configFingerprint, promptHash);

    if (!options.force) {
      const hit = await this.cache.get(cacheKey);
      if (hit) {
        hit.metrics.performance.cacheHit = true;
        return hit;
      }
    }

    const source: ParsedSource = {
      filePath,
      fileName: basename(filePath),
      fileFormat: format,
      fileSizeMB: Math.round((stats.size / (1024 * 1024)) * 1000) / 1000,
      fileHash,
      truncated: false,
      uploadedAt: new Date().toISOString(),
    };

    const detectSeals = options.detectSeals !== false && this.cfg.seal.enabled;
    const extractorCtx: ExtractorContext = {
      ocr: this.ocr,
      visionOcr: this.visionOcr,
      truncation: this.cfg.truncation,
      ocrConfig: this.cfg.ocr,
      ocrLimiter: this.ocrLimiter,
      detectSeals,
      fullPages: options.fullPages === true,
      metrics,
      ...(options.signal ? { signal: options.signal } : {}),
    };

    let raw: ParsedRaw = { fullText: '' };
    const extractStart = Date.now();
    switch (format) {
      case 'xlsx':
      case 'xls': {
        const r = await extractXlsx(filePath);
        raw = r.raw;
        source.sheetNames = r.sheetNames;
        metrics.addExtractMs(Date.now() - extractStart);
        break;
      }
      case 'pdf': {
        const r = await extractPdf(filePath, extractorCtx);
        raw = r.raw;
        source.pageCount = r.pageCount;
        source.pagesIncluded = r.pagesIncluded;
        source.truncated = r.truncated;
        break;
      }
      case 'doc':
      case 'docx': {
        const r = await extractDocx(filePath, extractorCtx);
        raw = r.raw;
        source.pageCount = r.pageCount;
        source.truncated = r.truncated;
        break;
      }
      case 'jpg':
      case 'png': {
        const r = await extractImage(filePath, extractorCtx);
        raw = r.raw;
        break;
      }
    }

    let extracted: Record<string, unknown> | undefined;

    if (options.prompt) {
      const llmStart = Date.now();
      const parsed = parsePromptFile(options.prompt);
      const userPrompt = buildUserPrompt(parsed.body, raw);
      const llmResult = await this.llm.extract({
        systemPrompt: parsed.body,
        userPrompt,
        ...(parsed.frontmatter.model ? { model: parsed.frontmatter.model } : {}),
        temperature: parsed.frontmatter.temperature ?? this.cfg.extraction.defaultTemperature,
      });
      // Pass the prompt's JSON shape through verbatim; the caller owns the schema.
      extracted = llmResult.fields;
      if (llmResult.parseFailed) warnings.push('llm-json-parse-failed-fallback-to-text');
      metrics.addLlmMs(Date.now() - llmStart);
      metrics.recordCall({
        model: llmResult.model,
        provider: 'openai-compat',
        promptTokens: llmResult.usage?.promptTokens ?? 0,
        completionTokens: llmResult.usage?.completionTokens ?? 0,
        ms: llmResult.ms,
        success: true,
      });
    }

    const fieldCount = extracted ? Object.keys(extracted).length : 0;
    const totalMs = Date.now() - start;

    if (warnings.length > 0) for (const _ of warnings) metrics.incWarning();

    const result: ParseResult = {
      schemaVersion: SCHEMA_VERSION,
      parsedAt: new Date().toISOString(),
      parserVersion: this.cfg.parserVersion,
      source,
      raw,
      metrics: metrics.build({
        fieldCount,
        fieldsAboveConfidence: 0,
        avgConfidence: 0,
        locatorResolveRate: 0,
        ocrCharsRecognized: raw.fullText?.length ?? 0,
        sealsDetected: raw.seals?.length ?? 0,
        signaturesDetected: raw.signatures?.length ?? 0,
        totalMs,
      }),
    };
    if (extracted) result.extracted = extracted;
    if (warnings.length > 0) result.warnings = warnings;

    try {
      await this.cache.put(cacheKey, result);
    } catch {
      // cache is best-effort; surface only once in warnings
      result.warnings = [...(result.warnings ?? []), 'cache-write-failed'];
    }

    return result;
  }
}

export function createFileParser(config: FileParserConfig): FileParser {
  return new FileParserImpl(resolveConfig(config));
}
