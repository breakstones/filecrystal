import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import type {
  ParsedRaw,
  ParsedRawPage,
  SealDetection,
  SignatureDetection,
} from '../types.js';
import { selectPages } from './utils/select-pages.js';
import type { ExtractorContext } from './context.js';

const require = createRequire(import.meta.url);

interface PdfJsTextItem {
  str?: string;
  transform?: number[];
  height?: number;
  width?: number;
  hasEOL?: boolean;
}

interface PdfJsTextContent {
  items: PdfJsTextItem[];
}

interface PdfJsPage {
  getTextContent(): Promise<PdfJsTextContent>;
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: {
    canvasContext: unknown;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
  cleanup(): void;
}

interface PdfJsCanvasFactory {
  create(width: number, height: number): {
    canvas: {
      toBuffer(type: string): Buffer;
    };
    context: unknown;
  };
  destroy(resources: { canvas: unknown; context: unknown }): void;
}

interface PdfJsDocument {
  numPages: number;
  canvasFactory: PdfJsCanvasFactory;
  getPage(n: number): Promise<PdfJsPage>;
  cleanup(): Promise<void>;
  destroy(): Promise<void>;
}

interface PdfJsModule {
  getDocument(opts: { data: Uint8Array; verbosity?: number; isEvalSupported?: boolean }): {
    promise: Promise<PdfJsDocument>;
  };
}

let cachedPdfJs: PdfJsModule | undefined;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (cachedPdfJs) return cachedPdfJs;
  const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule;
  cachedPdfJs = mod;
  return mod;
}

const OCR_TEXT_THRESHOLD = 20;
const RENDER_SCALE = 2.0;
const JPEG_QUALITY = 85;

export interface PdfExtractResult {
  raw: ParsedRaw;
  pageCount: number;
  pagesIncluded: number[];
  truncated: boolean;
}

export async function extractPdf(
  filePath: string,
  ctx: ExtractorContext,
): Promise<PdfExtractResult> {
  const extractStart = Date.now();
  const data = new Uint8Array(await readFile(filePath));
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data, verbosity: 0, isEvalSupported: false });
  const pdf = await loadingTask.promise;

  const totalPages = pdf.numPages;
  const selected = ctx.fullPages
    ? range(1, totalPages)
    : selectPages(totalPages, ctx.truncation.headTailRatio, ctx.truncation.maxPages);
  const truncated = selected.length < totalPages;

  const pages: ParsedRawPage[] = [];
  const seals: SealDetection[] = [];
  const signatures: SignatureDetection[] = [];
  let ocrMs = 0;
  let sealMs = 0;
  let peakConcurrency = 0;

  const limiter = ctx.ocrLimiter;
  let inFlight = 0;

  const perPage = await Promise.all(
    selected.map((pageNo) =>
      limiter(async () => {
        inFlight++;
        peakConcurrency = Math.max(peakConcurrency, inFlight);
        try {
          return await processPage(pdf, pageNo, ctx);
        } finally {
          inFlight--;
        }
      }),
    ),
  );

  for (const r of perPage) {
    pages.push(r.page);
    ocrMs += r.ocrMs;
    sealMs += r.sealMs;
    for (const s of r.seals) seals.push(s);
    for (const sig of r.signatures) signatures.push(sig);
  }

  const fullText = pages.map((p) => `--- Page ${p.pageNo} ---\n${p.text}`).join('\n\n');

  ctx.metrics.bumpConcurrencyPeak(peakConcurrency);
  ctx.metrics.addOcrMs(ocrMs);
  ctx.metrics.addSealMs(sealMs);

  await pdf.cleanup();
  await pdf.destroy();
  // OCR/seal already run concurrently; walltime - ocr - seal can underflow.
  // Clamp to 0 so extractMs strictly reflects non-OCR work on the critical path.
  const walltime = Date.now() - extractStart;
  const concurrentFloor = Math.max(ocrMs, sealMs);
  ctx.metrics.addExtractMs(Math.max(0, walltime - concurrentFloor));

  const raw: ParsedRaw = { pages, fullText };
  if (seals.length > 0) raw.seals = seals;
  if (signatures.length > 0) raw.signatures = signatures;

  return {
    raw,
    pageCount: totalPages,
    pagesIncluded: selected,
    truncated,
  };
}

async function processPage(
  pdf: PdfJsDocument,
  pageNo: number,
  ctx: ExtractorContext,
): Promise<{
  page: ParsedRawPage;
  seals: SealDetection[];
  signatures: SignatureDetection[];
  ocrMs: number;
  sealMs: number;
}> {
  const page = await pdf.getPage(pageNo);
  try {
    const textContent = await page.getTextContent();
    const textLayer = buildTextLayerString(textContent);
    const seals: SealDetection[] = [];
    const signatures: SignatureDetection[] = [];
    let ocrMs = 0;
    let sealMs = 0;

    const needsOcr = textLayer.length < OCR_TEXT_THRESHOLD;
    let text = textLayer;
    let blocks: ParsedRawPage['blocks'];

    if (needsOcr || ctx.detectSeals) {
      const rendered = await renderPageForOcr(pdf, page, ctx.ocrConfig.imageMaxLongEdge);
      ctx.metrics.incImagesProcessed();
      if (needsOcr) {
        const ocrStart = Date.now();
        const ocrResult = await ctx.ocr.recognize({
          imageBuffer: rendered.buffer,
          mimeType: rendered.mime,
          detectSealsAndSignatures: ctx.detectSeals,
          pageNoHint: pageNo,
        });
        ocrMs = Date.now() - ocrStart;
        text = ocrResult.text || text;
        blocks = ocrResult.blocks.map((b, idx) => ({
          blockId: `p${pageNo}-${b.blockId || `b${idx + 1}`}`,
          text: b.text,
          ...(b.bbox ? { bbox: b.bbox } : {}),
          ...(b.confidence !== undefined ? { confidence: b.confidence } : {}),
        }));
        ctx.metrics.recordCall({
          model: ocrResult.model,
          provider: ocrResult.provider ?? 'openai-compat',
          promptTokens: ocrResult.usage?.promptTokens ?? 0,
          completionTokens: ocrResult.usage?.completionTokens ?? 0,
          ms: ocrResult.ms,
          success: true,
        });
        if (ocrResult.seals) {
          for (const [i, s] of (ocrResult.seals as SealDetection[]).entries()) {
            seals.push(normaliseSeal(s, pageNo, i));
          }
        }
        if (ocrResult.signatures) {
          for (const [i, s] of (ocrResult.signatures as SignatureDetection[]).entries()) {
            signatures.push(normaliseSignature(s, pageNo, i));
          }
        }
      } else if (ctx.detectSeals) {
        const sealStart = Date.now();
        const res = await ctx.visionOcr.recognize({
          imageBuffer: rendered.buffer,
          mimeType: rendered.mime,
          detectSealsAndSignatures: true,
          pageNoHint: pageNo,
        });
        sealMs = Date.now() - sealStart;
        ctx.metrics.recordCall({
          model: res.model,
          provider: res.provider ?? 'openai-compat',
          promptTokens: res.usage?.promptTokens ?? 0,
          completionTokens: res.usage?.completionTokens ?? 0,
          ms: res.ms,
          success: true,
        });
        if (res.seals) {
          for (const [i, s] of (res.seals as SealDetection[]).entries()) {
            seals.push(normaliseSeal(s, pageNo, i));
          }
        }
        if (res.signatures) {
          for (const [i, s] of (res.signatures as SignatureDetection[]).entries()) {
            signatures.push(normaliseSignature(s, pageNo, i));
          }
        }
      }
    }

    const rawPage: ParsedRawPage = { pageNo, text };
    if (blocks) rawPage.blocks = blocks;
    return { page: rawPage, seals, signatures, ocrMs, sealMs };
  } finally {
    page.cleanup();
  }
}

function buildTextLayerString(content: PdfJsTextContent): string {
  let out = '';
  for (const item of content.items) {
    if (!item.str) continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
    else out += ' ';
  }
  return out.trim();
}

async function renderPageForOcr(
  pdf: PdfJsDocument,
  page: PdfJsPage,
  longEdgeCap: number,
): Promise<{ buffer: Buffer; mime: 'image/jpeg' }> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const { canvas, context } = pdf.canvasFactory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const raw = canvas.toBuffer('image/png');
  pdf.canvasFactory.destroy({ canvas, context });
  const buffer = await sharp(raw)
    .resize(longEdgeCap, longEdgeCap, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { buffer, mime: 'image/jpeg' };
}

function normaliseSeal(s: Partial<SealDetection> & { bbox?: [number, number, number, number] }, pageNo: number, idx: number): SealDetection {
  return {
    sealId: s.sealId ?? `seal-p${pageNo}-${idx + 1}`,
    type: s.type ?? 'unknown',
    ownerText: s.ownerText,
    shape: s.shape,
    color: s.color,
    confidence: s.confidence ?? 0.7,
    looksValid: s.looksValid,
    locator: s.locator ?? {
      kind: 'pdf-bbox',
      pageNo,
      ...(s.bbox ? { bbox: s.bbox } : {}),
    },
  };
}

function normaliseSignature(
  s: Partial<SignatureDetection> & { bbox?: [number, number, number, number] },
  pageNo: number,
  idx: number,
): SignatureDetection {
  return {
    signatureId: s.signatureId ?? `sig-p${pageNo}-${idx + 1}`,
    type: s.type ?? 'handwritten',
    signerText: s.signerText,
    confidence: s.confidence ?? 0.7,
    nearbyContext: s.nearbyContext,
    locator: s.locator ?? {
      kind: 'pdf-bbox',
      pageNo,
      ...(s.bbox ? { bbox: s.bbox } : {}),
    },
  };
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

// Keep the require() alive for bundlers that tree-shake unused imports.
void require;
