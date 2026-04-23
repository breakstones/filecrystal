// Canonical public type contract for filecrystal. Kept in sync with src/types.ts.
// Any breaking change here MUST be accompanied by a changeset and, if
// the on-wire JSON shape changes, a bump of SCHEMA_VERSION.

export declare const SCHEMA_VERSION: '1.0';

export type FileFormat = 'pdf' | 'jpg' | 'png' | 'xlsx' | 'xls' | 'doc' | 'docx';

export interface ParsedSource {
  filePath: string;
  fileName: string;
  fileFormat: FileFormat;
  fileSizeMB: number;
  fileHash: string;
  pageCount?: number;
  sheetNames?: string[];
  truncated: boolean;
  pagesIncluded?: number[];
  uploadedAt: string;
}

export interface SourceLocator {
  kind: 'pdf-bbox' | 'pdf-line' | 'sheet-cell' | 'doc-anchor' | 'image-bbox';
  pageNo?: number;
  bbox?: [number, number, number, number];
  lineNo?: number;
  sheet?: string;
  ref?: string;
  sectionId?: string;
  offset?: number;
}

export interface ExtractedField<T = unknown> {
  value: T;
  confidence: number;
  locator?: SourceLocator;
  rawHint?: string;
  snippet?: string;
}

export interface SealDetection {
  sealId: string;
  type: 'official' | 'finance' | 'contract' | 'invoice' | 'personal' | 'unknown';
  ownerText?: string;
  shape?: 'circle' | 'oval' | 'rectangle' | 'square';
  color?: 'red' | 'blue' | 'black';
  locator: SourceLocator;
  confidence: number;
  looksValid?: boolean;
}

export interface SignatureDetection {
  signatureId: string;
  type: 'handwritten' | 'e-signature' | 'stamp-signature';
  signerText?: string;
  locator: SourceLocator;
  confidence: number;
  nearbyContext?: string;
}

export interface ParsedRawPage {
  pageNo: number;
  text: string;
  blocks?: Array<{
    blockId: string;
    text: string;
    bbox?: [number, number, number, number];
    confidence?: number;
  }>;
}

export interface ParsedRawSheet {
  sheetName: string;
  cells: Array<{
    ref: string;
    value: string | number | boolean | null;
    formula?: string;
  }>;
  mergedRanges?: string[];
}

export interface ParsedRawSection {
  sectionId: string;
  title?: string;
  text: string;
}

export interface ParsedRaw {
  pages?: ParsedRawPage[];
  sheets?: ParsedRawSheet[];
  sections?: ParsedRawSection[];
  fullText?: string;
  seals?: SealDetection[];
  signatures?: SignatureDetection[];
}

export interface ParseQualityMetrics {
  fieldCount: number;
  fieldsAboveConfidence: number;
  avgConfidence: number;
  locatorResolveRate: number;
  ocrCharsRecognized: number;
  sealsDetected: number;
  signaturesDetected: number;
  warningsCount: number;
}

export interface ParsePerformanceMetrics {
  totalMs: number;
  extractMs: number;
  ocrMs: number;
  sealMs: number;
  llmMs: number;
  cacheHit: boolean;
  ocrConcurrencyPeak: number;
  retries: number;
  imagesProcessed: number;
}

export interface ParseCostMetrics {
  totalYuan: number;
  callsByModel: Record<
    string,
    {
      calls: number;
      promptTokens: number;
      completionTokens: number;
      imageTokens?: number;
      yuan: number;
    }
  >;
}

export interface ParseMetrics {
  quality: ParseQualityMetrics;
  performance: ParsePerformanceMetrics;
  cost: ParseCostMetrics;
}

export interface ParseResult {
  schemaVersion: typeof SCHEMA_VERSION;
  parsedAt: string;
  parserVersion: string;
  source: ParsedSource;
  raw: ParsedRaw;
  /**
   * Raw LLM output when a prompt was supplied. The prompt's JSON shape is
   * passed through verbatim — the caller's prompt owns the schema. When the
   * model's response cannot be parsed as JSON even after best-effort repair,
   * this is `{ text: "<raw model output>" }`.
   */
  extracted?: Record<string, unknown>;
  metrics: ParseMetrics;
  warnings?: string[];
}

export interface ParseOptions {
  prompt?: string;
  documentType?: string;
  fullPages?: boolean;
  force?: boolean;
  detectSeals?: boolean;
  signal?: AbortSignal;
}

export interface FileParserConfig {
  mode: 'mock' | 'api';
  cacheDir?: string;
  parserVersion?: string;
  openai?: {
    baseUrl: string;
    apiKey: string;
    models: {
      ocr?: string;
      vision?: string;
      text?: string;
    };
  };
  ocr?: {
    maxConcurrency?: number;
    timeoutMs?: number;
    retries?: number;
    imageMaxLongEdge?: number;
  };
  extraction?: {
    defaultTemperature?: number;
    timeoutMs?: number;
  };
  seal?: {
    enabled?: boolean;
    mergeWithOcr?: boolean;
  };
  truncation?: {
    maxPages?: number;
    headTailRatio?: [number, number];
    docxMaxChars?: number;
  };
}

export interface FileParser {
  parse(filePath: string, options?: ParseOptions): Promise<ParseResult>;
}

export declare function createFileParser(config: FileParserConfig): FileParser;
