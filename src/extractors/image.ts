import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { ParsedRaw, ParsedRawPage, SealDetection, SignatureDetection } from '../types.js';
import type { ExtractorContext } from './context.js';

export interface ImageExtractResult {
  raw: ParsedRaw;
}

export async function extractImage(
  filePath: string,
  ctx: ExtractorContext,
): Promise<ImageExtractResult> {
  const extractStart = Date.now();
  const input = await readFile(filePath);
  const longEdge = ctx.ocrConfig.imageMaxLongEdge;

  const normalised = await sharp(input)
    .rotate() // no-args rotate() auto-orients using EXIF metadata
    .resize(longEdge, longEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  ctx.metrics.addExtractMs(Date.now() - extractStart);
  ctx.metrics.incImagesProcessed();

  const ocrStart = Date.now();
  const ocrResult = await ctx.ocrLimiter(() =>
    ctx.ocr.recognize({
      imageBuffer: normalised,
      mimeType: 'image/jpeg',
      detectSealsAndSignatures: ctx.detectSeals,
      pageNoHint: 1,
    }),
  );
  ctx.metrics.addOcrMs(Date.now() - ocrStart);
  ctx.metrics.recordCall({
    model: ocrResult.model,
    provider: ocrResult.provider ?? 'openai-compat',
    promptTokens: ocrResult.usage?.promptTokens ?? 0,
    completionTokens: ocrResult.usage?.completionTokens ?? 0,
    ms: ocrResult.ms,
    success: true,
  });

  const page: ParsedRawPage = {
    pageNo: 1,
    text: ocrResult.text,
    blocks: ocrResult.blocks.map((b, idx) => ({
      blockId: b.blockId || `b${idx + 1}`,
      text: b.text,
      ...(b.bbox ? { bbox: b.bbox } : {}),
      ...(b.confidence !== undefined ? { confidence: b.confidence } : {}),
    })),
  };

  const seals: SealDetection[] = (ocrResult.seals ?? []).map((raw, i) => {
    const s = raw as Partial<SealDetection> & { bbox?: [number, number, number, number] };
    return {
      sealId: s.sealId ?? `seal-1-${i + 1}`,
      type: s.type ?? 'unknown',
      ownerText: s.ownerText,
      shape: s.shape,
      color: s.color,
      confidence: s.confidence ?? 0.7,
      looksValid: s.looksValid,
      locator: s.locator ?? {
        kind: 'image-bbox',
        pageNo: 1,
        ...(s.bbox ? { bbox: s.bbox } : {}),
      },
    };
  });

  const signatures: SignatureDetection[] = (ocrResult.signatures ?? []).map((raw, i) => {
    const s = raw as Partial<SignatureDetection> & { bbox?: [number, number, number, number] };
    return {
      signatureId: s.signatureId ?? `sig-1-${i + 1}`,
      type: s.type ?? 'handwritten',
      signerText: s.signerText,
      confidence: s.confidence ?? 0.7,
      nearbyContext: s.nearbyContext,
      locator: s.locator ?? {
        kind: 'image-bbox',
        pageNo: 1,
        ...(s.bbox ? { bbox: s.bbox } : {}),
      },
    };
  });

  const raw: ParsedRaw = {
    pages: [page],
    fullText: page.text,
  };
  if (seals.length > 0) raw.seals = seals;
  if (signatures.length > 0) raw.signatures = signatures;

  return { raw };
}
