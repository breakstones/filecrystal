import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import type {
  ExtractedField,
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
import { sha256File } from './extractors/utils/file-hash.js';
import { MetricsCollector } from './metrics/collector.js';
import { createMockLlmBackend } from './mocks/llm.js';
import { createMockOcrBackend } from './mocks/ocr.js';
import type { LlmBackend } from './llm/backend.js';
import type { OcrBackend } from './ocr/backend.js';
import { createOpenAICompatLlmBackend } from './llm/openai-compat.js';
import { createOpenAICompatOcrBackend } from './ocr/openai-compat.js';
import { parsePromptFile, buildUserPrompt } from './llm/prompt.js';
import { resolveLocator } from './llm/resolve-locator.js';

class FileParserImpl implements FileParser {
  private readonly cfg: ResolvedConfig;
  private readonly ocr: OcrBackend;
  private readonly llm: LlmBackend;

  constructor(cfg: ResolvedConfig) {
    this.cfg = cfg;
    if (cfg.mode === 'mock' || !cfg.openai) {
      this.ocr = createMockOcrBackend();
      this.llm = createMockLlmBackend();
    } else {
      this.ocr = createOpenAICompatOcrBackend({
        baseUrl: cfg.openai.baseUrl,
        apiKey: cfg.openai.apiKey,
        model: cfg.openai.models.ocr,
        timeoutMs: cfg.ocr.timeoutMs,
        retries: cfg.ocr.retries,
      });
      this.llm = createOpenAICompatLlmBackend({
        baseUrl: cfg.openai.baseUrl,
        apiKey: cfg.openai.apiKey,
        model: cfg.openai.models.text,
        timeoutMs: cfg.extraction.timeoutMs,
      });
    }
  }

  async parse(filePath: string, options: ParseOptions = {}): Promise<ParseResult> {
    const metrics = new MetricsCollector();
    const warnings: string[] = [];
    const start = Date.now();

    const format = detectFormat(filePath);
    const stats = await stat(filePath);
    const fileHash = await sha256File(filePath);

    const source: ParsedSource = {
      filePath,
      fileName: basename(filePath),
      fileFormat: format,
      fileSizeMB: Math.round((stats.size / (1024 * 1024)) * 1000) / 1000,
      fileHash,
      truncated: false,
      uploadedAt: new Date().toISOString(),
    };

    const extractStart = Date.now();
    let raw: ParsedRaw = { fullText: '' };
    switch (format) {
      case 'xlsx':
      case 'xls': {
        const r = await extractXlsx(filePath);
        raw = r.raw;
        source.sheetNames = r.sheetNames;
        break;
      }
      case 'pdf': {
        const r = await extractPdf(filePath);
        raw = r.raw;
        source.pageCount = r.pageCount;
        source.pagesIncluded = r.pagesIncluded;
        source.truncated = r.truncated;
        if (!raw.pages || raw.pages.length === 0) warnings.push('pdf-stage-b-placeholder');
        break;
      }
      case 'doc':
      case 'docx': {
        const r = await extractDocx(filePath);
        raw = r.raw;
        source.pageCount = r.pageCount;
        source.truncated = r.truncated;
        if (!raw.sections || raw.sections.length === 0) warnings.push('docx-stage-c-placeholder');
        break;
      }
      case 'jpg':
      case 'png': {
        const r = await extractImage(filePath);
        raw = r.raw;
        warnings.push('image-stage-b-placeholder');
        break;
      }
    }
    metrics.addExtractMs(Date.now() - extractStart);

    let extracted: Record<string, ExtractedField> | undefined;
    let locatorResolveCount = 0;
    let confidenceSum = 0;
    let fieldsAboveConfidence = 0;

    if (options.prompt) {
      const llmStart = Date.now();
      const parsed = parsePromptFile(options.prompt);
      const userPrompt = buildUserPrompt(parsed.body, raw);
      const llmResult = await this.llm.extract({
        systemPrompt: parsed.body,
        userPrompt,
        model: parsed.frontmatter.model,
        temperature: parsed.frontmatter.temperature ?? this.cfg.extraction.defaultTemperature,
      });
      extracted = {};
      for (const [key, field] of Object.entries(llmResult.fields)) {
        const resolved = resolveLocator(field.rawHint, raw);
        const conf = (field.confidence ?? 0.5) * resolved.confidencePenalty;
        const enriched: ExtractedField = {
          value: field.value,
          confidence: conf,
        };
        if (resolved.locator) enriched.locator = resolved.locator;
        if (field.rawHint) enriched.rawHint = field.rawHint;
        if (field.snippet) enriched.snippet = field.snippet;
        extracted[key] = enriched;
        confidenceSum += conf;
        if (resolved.locator) locatorResolveCount++;
        if (conf >= 0.7) fieldsAboveConfidence++;
      }
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

    const result: ParseResult = {
      schemaVersion: SCHEMA_VERSION,
      parsedAt: new Date().toISOString(),
      parserVersion: this.cfg.parserVersion,
      source,
      raw,
      metrics: metrics.build({
        fieldCount,
        fieldsAboveConfidence,
        avgConfidence: fieldCount > 0 ? confidenceSum / fieldCount : 0,
        locatorResolveRate: fieldCount > 0 ? locatorResolveCount / fieldCount : 0,
        ocrCharsRecognized: raw.fullText?.length ?? 0,
        sealsDetected: raw.seals?.length ?? 0,
        signaturesDetected: raw.signatures?.length ?? 0,
        totalMs,
      }),
    };
    if (extracted) result.extracted = extracted;
    if (warnings.length > 0) {
      for (const _ of warnings) metrics.incWarning();
      result.warnings = warnings;
    }
    return result;
  }
}

export function createFileParser(config: FileParserConfig): FileParser {
  return new FileParserImpl(resolveConfig(config));
}
