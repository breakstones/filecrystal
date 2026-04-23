import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import type { ParsedRaw, ParsedRawSection, SealDetection, SignatureDetection } from '../types.js';
import type { ExtractorContext } from './context.js';
import { truncateText } from './utils/truncate-text.js';
import { FileParserError, ErrorCode } from '../utils/errors.js';

export interface DocxExtractResult {
  raw: ParsedRaw;
  pageCount: number;
  truncated: boolean;
}

export async function extractDocx(
  filePath: string,
  ctx: ExtractorContext,
): Promise<DocxExtractResult> {
  const extractStart = Date.now();
  const ext = extname(filePath).toLowerCase();

  const fullText = ext === '.doc' ? await extractDocFallback(filePath) : await extractDocxMain(filePath);

  const truncation = truncateText(
    fullText,
    ctx.truncation.docxMaxChars,
    Math.floor(ctx.truncation.docxMaxChars * 0.7),
    Math.floor(ctx.truncation.docxMaxChars * 0.3),
  );

  const paragraphs = truncation.text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const sections: ParsedRawSection[] = paragraphs.map((text, idx) => ({
    sectionId: `p-${idx + 1}`,
    text,
  }));

  const seals: SealDetection[] = [];
  const signatures: SignatureDetection[] = [];
  const embeddedImages: Buffer[] = ext === '.docx' ? await extractEmbeddedImages(filePath) : [];

  if (ctx.detectSeals && embeddedImages.length > 0) {
    const sealWallStart = Date.now();
    const perImage = await Promise.all(
      embeddedImages.map((img, i) =>
        ctx.ocrLimiter(async () => {
          const res = await ctx.visionOcr.recognize({
            imageBuffer: img,
            mimeType: 'image/png',
            detectSealsAndSignatures: true,
          });
          return { i, res };
        }),
      ),
    );
    for (const { i, res } of perImage) {
      ctx.metrics.incImagesProcessed();
      ctx.metrics.recordCall({
        model: res.model,
        provider: 'openai-compat',
        promptTokens: res.usage?.promptTokens ?? 0,
        completionTokens: res.usage?.completionTokens ?? 0,
        ms: res.ms,
        success: true,
      });
      for (const s of res.seals ?? []) {
        seals.push({
          sealId: `seal-docx-img${i + 1}-${seals.length + 1}`,
          type: (s as SealDetection).type ?? 'unknown',
          ownerText: (s as SealDetection).ownerText,
          shape: (s as SealDetection).shape,
          color: (s as SealDetection).color,
          confidence: (s as SealDetection).confidence ?? 0.7,
          looksValid: (s as SealDetection).looksValid,
          locator: { kind: 'image-bbox', sectionId: `embedded-img-${i + 1}` },
        });
      }
      for (const sig of res.signatures ?? []) {
        signatures.push({
          signatureId: `sig-docx-img${i + 1}-${signatures.length + 1}`,
          type: (sig as SignatureDetection).type ?? 'handwritten',
          signerText: (sig as SignatureDetection).signerText,
          confidence: (sig as SignatureDetection).confidence ?? 0.7,
          nearbyContext: (sig as SignatureDetection).nearbyContext,
          locator: { kind: 'image-bbox', sectionId: `embedded-img-${i + 1}` },
        });
      }
    }
    ctx.metrics.addSealMs(Date.now() - sealWallStart);
  }

  ctx.metrics.addExtractMs(Date.now() - extractStart);

  const raw: ParsedRaw = {
    sections,
    fullText: truncation.text,
  };
  if (seals.length > 0) raw.seals = seals;
  if (signatures.length > 0) raw.signatures = signatures;

  const approxPageCount = Math.max(1, Math.ceil(truncation.originalLength / 500));

  return {
    raw,
    pageCount: approxPageCount,
    truncated: truncation.truncated,
  };
}

async function extractDocxMain(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return (result.value || '').trim();
}

async function extractDocFallback(filePath: string): Promise<string> {
  try {
    const WordExtractorMod = (await import('word-extractor')) as unknown as {
      default?: new () => { extract(path: string): Promise<{ getBody(): string }> };
    };
    const Ctor = WordExtractorMod.default;
    if (!Ctor) throw new Error('word-extractor default export missing');
    const extractor = new Ctor();
    const doc = await extractor.extract(filePath);
    return (doc.getBody() || '').trim();
  } catch (err) {
    throw new FileParserError(ErrorCode.UNSUPPORTED_FORMAT, 'Failed to parse legacy .doc file', {
      cause: String(err),
    });
  }
}

async function extractEmbeddedImages(filePath: string): Promise<Buffer[]> {
  const collected: Buffer[] = [];
  const buffer = await readFile(filePath);
  await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          const buf = await image.readAsBuffer();
          collected.push(buf);
        } catch {
          // ignore individual image failures
        }
        return { src: '' };
      }),
    },
  );
  return collected;
}
