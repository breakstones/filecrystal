import { Readable } from 'node:stream';
import type { OcrBackend, OcrBlock, OcrRequest, OcrResult } from '../backend.js';
import { retry } from '../../utils/concurrency.js';
import { ErrorCode, FileParserError } from '../../utils/errors.js';

export interface AliyunOcrBackendOptions {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint?: string;
  regionId?: string;
  timeoutMs?: number;
  retries?: number;
  outputTable?: boolean;
  row?: boolean;
  paragraph?: boolean;
}

type AliyunSdkClient = new (config: Record<string, unknown>) => {
  recognizeAdvancedWithOptions?: (request: unknown, runtime: unknown) => Promise<unknown>;
  recognizeAdvanced?: (request: unknown) => Promise<unknown>;
};

type AliyunSdkModule = {
  default?: (AliyunSdkClient & Record<string, unknown>) | { default?: AliyunSdkClient };
} & Record<string, unknown>;

interface AliyunRecognizeAdvancedData {
  content?: string;
  prism_wordsInfo?: AliyunWordInfo[];
  prism_paragraphsInfo?: Array<{ word?: string; text?: string }>;
  prism_rowsInfo?: Array<{ word?: string; text?: string }>;
  prism_tablesInfo?: AliyunTableInfo[];
  subImages?: AliyunSubImage[];
  [key: string]: unknown;
}

interface AliyunSubImage {
  tableInfo?: { tableDetails?: AliyunTableInfo[]; tableHtml?: string };
  rowInfo?: { rowDetails?: Array<{ rowContent?: string }> };
  paragraphInfo?: { paragraphDetails?: Array<{ paragraphContent?: string }> };
  [key: string]: unknown;
}

interface AliyunTableInfo {
  tableId?: number;
  rowCount?: number;
  columnCount?: number;
  xCellSize?: number;
  yCellSize?: number;
  cellDetails?: AliyunTableCell[];
  cellInfos?: AliyunTableCell[];
  [key: string]: unknown;
}

interface AliyunTableCell {
  cellContent?: string;
  word?: string;
  rowStart?: number;
  rowEnd?: number;
  columnStart?: number;
  columnEnd?: number;
  xsc?: number;
  xec?: number;
  ysc?: number;
  yec?: number;
  [key: string]: unknown;
}

interface AliyunWordInfo {
  word?: string;
  text?: string;
  pos?: AliyunPoint[];
  position?: AliyunPoint[] | AliyunBbox;
  points?: AliyunPoint[];
  prob?: number;
  probability?: number;
  confidence?: number;
  angle?: number;
  [key: string]: unknown;
}

type AliyunPoint = { x?: number; y?: number } | [number, number];
type AliyunBbox = { x?: number; y?: number; width?: number; height?: number };

export function createAliyunOcrBackend(opts: AliyunOcrBackendOptions): OcrBackend {
  return {
    async recognize(req: OcrRequest): Promise<OcrResult> {
      const start = Date.now();
      try {
        const response = await retry(() => callRecognizeAdvanced(opts, req), {
          retries: opts.retries ?? 2,
        });
        const data = parseData(response);
        const words = data.prism_wordsInfo ?? [];
        const blocks = normaliseAliyunBlocks(words);
        const text = extractText(data, blocks, words);
        return {
          text,
          blocks,
          usage: {
            providerSpecific: {
              words: blocks.length,
            },
          },
          model: 'RecognizeAdvanced',
          ms: Date.now() - start,
          provider: 'aliyun-ocr',
          avgConfidence: averageConfidence(blocks),
        };
      } catch (err) {
        if (err instanceof FileParserError) throw err;
        throw new FileParserError(ErrorCode.OCR_FAILED, 'Aliyun OCR RecognizeAdvanced failed', {
          cause: safeErrorMessage(err),
        });
      }
    },
  };
}

async function callRecognizeAdvanced(
  opts: AliyunOcrBackendOptions,
  req: OcrRequest,
): Promise<unknown> {
  const sdk = await loadAliyunSdk();
  const Client = resolveClientCtor(sdk);
  if (!Client) {
    throw new FileParserError(
      ErrorCode.CONFIG_INVALID,
      'Aliyun OCR SDK default export missing. Install @alicloud/ocr-api20210707.',
    );
  }

  const client = new Client({
    accessKeyId: opts.accessKeyId,
    accessKeySecret: opts.accessKeySecret,
    type: 'access_key',
    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
    ...(opts.regionId ? { regionId: opts.regionId } : {}),
  });

  const RequestCtor = sdk.RecognizeAdvancedRequest as (new (args: Record<string, unknown>) => unknown) | undefined;
  const RuntimeCtor = sdk.RuntimeOptions as (new (args: Record<string, unknown>) => unknown) | undefined;

  const requestPayload = {
    body: Readable.from(req.imageBuffer),
    ...(opts.outputTable !== undefined ? { outputTable: opts.outputTable } : {}),
    ...(opts.row !== undefined ? { row: opts.row } : {}),
    ...(opts.paragraph !== undefined ? { paragraph: opts.paragraph } : {}),
    // Always request automatic rotation for Aliyun OCR. Real-file validation on
    // rotated PDF pages showed a large quality improvement with minimal latency
    // impact, and the API's documented default is false.
    needRotate: true,
  };
  const request = RequestCtor ? new RequestCtor(requestPayload) : requestPayload;
  const runtime = RuntimeCtor
    ? new RuntimeCtor({
        readTimeout: opts.timeoutMs ?? 45_000,
        connectTimeout: Math.min(10_000, opts.timeoutMs ?? 45_000),
        autoretry: false,
      })
    : { readTimeout: opts.timeoutMs ?? 45_000, connectTimeout: 10_000, autoretry: false };

  if (typeof client.recognizeAdvancedWithOptions === 'function') {
    return client.recognizeAdvancedWithOptions(request, runtime);
  }
  if (typeof client.recognizeAdvanced === 'function') {
    return client.recognizeAdvanced(request);
  }
  throw new FileParserError(
    ErrorCode.CONFIG_INVALID,
    'Aliyun OCR SDK client does not expose recognizeAdvancedWithOptions/recognizeAdvanced.',
  );
}

function resolveClientCtor(sdk: AliyunSdkModule): AliyunSdkClient | undefined {
  if (typeof sdk.default === 'function') return sdk.default;
  if (sdk.default && typeof (sdk.default as { default?: unknown }).default === 'function') {
    return (sdk.default as { default: AliyunSdkClient }).default;
  }
  return undefined;
}

async function loadAliyunSdk(): Promise<AliyunSdkModule> {
  try {
    const specifier = '@alicloud/ocr-api20210707';
    return (await import(specifier)) as AliyunSdkModule;
  } catch (err) {
    throw new FileParserError(
      ErrorCode.CONFIG_INVALID,
      'Aliyun OCR provider requires optional dependency @alicloud/ocr-api20210707.',
      { cause: safeErrorMessage(err) },
    );
  }
}

function parseData(response: unknown): AliyunRecognizeAdvancedData {
  const body = (response as { body?: unknown })?.body ?? response;
  const rawData = (body as { Data?: unknown; data?: unknown })?.Data ?? (body as { data?: unknown })?.data;
  if (typeof rawData === 'string') {
    try {
      return JSON.parse(rawData) as AliyunRecognizeAdvancedData;
    } catch {
      return { content: rawData, prism_wordsInfo: [] };
    }
  }
  if (rawData && typeof rawData === 'object') return rawData as AliyunRecognizeAdvancedData;
  return { prism_wordsInfo: [] };
}

function normaliseAliyunBlocks(words: AliyunWordInfo[]): OcrBlock[] {
  return words
    .map((w, idx): OcrBlock | null => {
      const text = w.word ?? w.text ?? '';
      if (!text) return null;
      return {
        blockId: `aliyun-${idx + 1}`,
        text,
        ...optionalBbox(normaliseBbox(w)),
        ...optionalConfidence(normaliseConfidence(w.prob ?? w.probability ?? w.confidence)),
      };
    })
    .filter((b): b is OcrBlock => b !== null);
}

function optionalBbox(bbox: [number, number, number, number] | undefined): { bbox?: [number, number, number, number] } {
  return bbox ? { bbox } : {};
}

function optionalConfidence(confidence: number | undefined): { confidence?: number } {
  return confidence === undefined ? {} : { confidence };
}

function normaliseBbox(word: AliyunWordInfo): [number, number, number, number] | undefined {
  const raw = word.position ?? word.pos ?? word.points;
  if (!raw) return undefined;
  if (!Array.isArray(raw)) {
    const { x, y, width, height } = raw;
    if ([x, y, width, height].every((v) => typeof v === 'number')) {
      return [x as number, y as number, width as number, height as number];
    }
    return undefined;
  }
  const points = raw
    .map((p): [number, number] | undefined => {
      if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') return [p[0], p[1]];
      const maybe = p as { x?: number; y?: number };
      if (typeof maybe.x === 'number' && typeof maybe.y === 'number') return [maybe.x, maybe.y];
      return undefined;
    })
    .filter((p): p is [number, number] => p !== undefined);
  if (points.length === 0) return undefined;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return [minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY];
}

function normaliseConfidence(raw: number | undefined): number | undefined {
  if (raw === undefined || !Number.isFinite(raw)) return undefined;
  if (raw > 1) return Math.max(0, Math.min(1, raw / 100));
  return Math.max(0, Math.min(1, raw));
}

function extractText(
  data: AliyunRecognizeAdvancedData,
  blocks: OcrBlock[],
  words: AliyunWordInfo[],
): string {
  const sections: string[] = [];
  const tables = extractTables(data);
  if (tables.length > 0) sections.push(...tables.map(renderTableMarkdown));

  const structuredText = extractStructuredText(data);
  if (structuredText) sections.push(structuredText);

  if (sections.length > 0) return sections.join('\n\n').trim();

  const markdown = blocksToMarkdown(blocks, words);
  if (markdown) return markdown;

  if (typeof data.content === 'string' && data.content.trim()) {
    return data.content
      .trim()
      .split(/\n+/)
      .map((line) => escapeMarkdownText(line.trim()))
      .filter(Boolean)
      .join('\n');
  }

  return blocks.map((b) => escapeMarkdownText(b.text)).join('\n');
}

function extractTables(data: AliyunRecognizeAdvancedData): AliyunTableInfo[] {
  const tables: AliyunTableInfo[] = [];
  if (Array.isArray(data.prism_tablesInfo)) tables.push(...data.prism_tablesInfo);
  for (const sub of data.subImages ?? []) {
    const details = sub.tableInfo?.tableDetails;
    if (Array.isArray(details)) tables.push(...details);
  }
  return tables.filter((t) => tableCells(t).length > 0);
}

function extractStructuredText(data: AliyunRecognizeAdvancedData): string {
  const paragraphs = [
    ...(data.prism_paragraphsInfo?.map((p) => p.word ?? p.text ?? '') ?? []),
    ...((data.subImages ?? []).flatMap((sub) =>
      sub.paragraphInfo?.paragraphDetails?.map((p) => p.paragraphContent ?? '') ?? [],
    )),
  ].filter((t) => t.trim().length > 0);
  if (paragraphs.length > 0) return paragraphs.map(escapeMarkdownText).join('\n\n');

  const rows = [
    ...(data.prism_rowsInfo?.map((r) => r.word ?? r.text ?? '') ?? []),
    ...((data.subImages ?? []).flatMap((sub) =>
      sub.rowInfo?.rowDetails?.map((r) => r.rowContent ?? '') ?? [],
    )),
  ].filter((t) => t.trim().length > 0);
  if (rows.length > 0) return rows.map(escapeMarkdownText).join('\n');

  return '';
}

function renderTableMarkdown(table: AliyunTableInfo): string {
  const cells = tableCells(table);
  const maxRow = Math.max(table.rowCount ?? table.yCellSize ?? 0, ...cells.map((c) => cellRowEnd(c))) + 1;
  const maxCol = Math.max(table.columnCount ?? table.xCellSize ?? 0, ...cells.map((c) => cellColumnEnd(c))) + 1;
  if (maxRow <= 0 || maxCol <= 0) return '';

  const grid = Array.from({ length: maxRow }, () => Array.from({ length: maxCol }, () => ''));
  for (const cell of cells) {
    const rowStart = Math.max(0, cellRowStart(cell));
    const rowEnd = Math.max(rowStart, cellRowEnd(cell));
    const colStart = Math.max(0, cellColumnStart(cell));
    const colEnd = Math.max(colStart, cellColumnEnd(cell));
    const text = escapeTableCell(cell.cellContent ?? cell.word ?? '');
    grid[rowStart]![colStart] = text;
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        if (r === rowStart && c === colStart) continue;
        grid[r]![c] = grid[r]![c] || '';
      }
    }
  }

  const trimmed = trimEmptyRowsAndCols(grid);
  if (trimmed.length === 0) return '';
  const header = trimmed[0]!.map((v, i) => v || `Column ${i + 1}`);
  const body = trimmed.slice(1);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function tableCells(table: AliyunTableInfo): AliyunTableCell[] {
  return table.cellDetails ?? table.cellInfos ?? [];
}

function cellRowStart(cell: AliyunTableCell): number {
  return cell.rowStart ?? cell.ysc ?? 0;
}

function cellRowEnd(cell: AliyunTableCell): number {
  return cell.rowEnd ?? cell.yec ?? cellRowStart(cell);
}

function cellColumnStart(cell: AliyunTableCell): number {
  return cell.columnStart ?? cell.xsc ?? 0;
}

function cellColumnEnd(cell: AliyunTableCell): number {
  return cell.columnEnd ?? cell.xec ?? cellColumnStart(cell);
}

function trimEmptyRowsAndCols(grid: string[][]): string[][] {
  const nonEmptyRows = grid.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (nonEmptyRows.length === 0) return [];
  const cols = nonEmptyRows[0]?.length ?? 0;
  const keepCols: number[] = [];
  for (let c = 0; c < cols; c++) {
    if (nonEmptyRows.some((row) => (row[c] ?? '').trim().length > 0)) keepCols.push(c);
  }
  return nonEmptyRows.map((row) => keepCols.map((c) => row[c] ?? ''));
}

function blocksToMarkdown(blocks: OcrBlock[], words: AliyunWordInfo[]): string {
  const positioned = blocks
    .map((block, idx) => ({ block, word: words[idx], bbox: block.bbox }))
    .filter((item): item is { block: OcrBlock; word: AliyunWordInfo | undefined; bbox: [number, number, number, number] } =>
      item.bbox !== undefined,
    );
  if (positioned.length === 0) return '';

  const sorted = [...positioned].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  const avgHeight = sorted.reduce((sum, item) => sum + Math.max(1, item.bbox[3]), 0) / sorted.length;
  const lineThreshold = Math.max(8, avgHeight * 0.65);
  const lines: Array<typeof sorted> = [];

  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push([item]);
      continue;
    }
    const lastY = median(last.map((x) => x.bbox[1]));
    if (Math.abs(item.bbox[1] - lastY) <= lineThreshold) last.push(item);
    else lines.push([item]);
  }

  const rendered = lines.map((line) => renderMarkdownLine(line)).filter(Boolean);
  return groupMarkdownLines(rendered, avgHeight);
}

function renderMarkdownLine(
  line: Array<{ block: OcrBlock; word: AliyunWordInfo | undefined; bbox: [number, number, number, number] }>,
): string {
  const ordered = [...line].sort((a, b) => a.bbox[0] - b.bbox[0]);
  const texts: string[] = [];
  let previousRight: number | undefined;
  const avgWidth = ordered.reduce((sum, item) => sum + Math.max(1, item.bbox[2]), 0) / Math.max(1, ordered.length);

  for (const item of ordered) {
    const text = escapeMarkdownText(item.block.text.trim());
    if (!text) continue;
    const gap = previousRight === undefined ? 0 : item.bbox[0] - previousRight;
    if (texts.length > 0 && gap > Math.max(24, avgWidth * 0.8)) texts.push(' ');
    texts.push(text);
    previousRight = item.bbox[0] + item.bbox[2];
  }
  return texts.join('').replace(/\s+/g, ' ').trim();
}

function groupMarkdownLines(lines: string[], avgHeight: number): string {
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (looksLikeHeading(trimmed)) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      out.push(`## ${trimmed.replace(/^#+\s*/, '')}`);
      out.push('');
      continue;
    }
    if (looksLikeListItem(trimmed)) {
      out.push(`- ${trimmed.replace(/^[-•·]\s*/, '')}`);
      continue;
    }
    if (out.length > 0 && shouldStartParagraph(out[out.length - 1] ?? '', trimmed, avgHeight)) out.push('');
    out.push(trimmed);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function looksLikeHeading(line: string): boolean {
  if (line.length > 40) return false;
  if (/[:：。；;,.，]$/.test(line)) return false;
  return /(合同|协议|证明|申请表|验收表|汇总表|进度款|账户|发票|收据|报告|照片)$/.test(line);
}

function looksLikeListItem(line: string): boolean {
  return /^[-•·]\s*/.test(line);
}

function shouldStartParagraph(previous: string, current: string, _avgHeight: number): boolean {
  if (!previous || previous === '') return false;
  if (/^(## |[-*] )/.test(previous)) return false;
  if (/^[一二三四五六七八九十]+[、.．]/.test(current)) return true;
  if (/^\d+[、.．)]/.test(current)) return true;
  return /[。！？!?；;：:]$/.test(previous);
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function escapeTableCell(text: string): string {
  return escapeMarkdownText(text).replace(/\s+/g, ' ');
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function averageConfidence(blocks: OcrBlock[]): number | undefined {
  const values = blocks
    .map((b) => b.confidence)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 1000) / 1000;
}

function safeErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string; statusCode?: number };
  const parts = [e?.code, e?.statusCode, e?.message].filter((p) => p !== undefined && p !== '');
  return parts.join(' ') || String(err);
}
