import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const sourceLocatorSchema = z.object({
  kind: z.enum(['pdf-bbox', 'pdf-line', 'sheet-cell', 'doc-anchor', 'image-bbox']),
  pageNo: z.number().int().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  lineNo: z.number().int().optional(),
  sheet: z.string().optional(),
  ref: z.string().optional(),
  sectionId: z.string().optional(),
  offset: z.number().int().optional(),
});

const extractedFieldSchema = z.object({
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  locator: sourceLocatorSchema.optional(),
  rawHint: z.string().optional(),
  snippet: z.string().optional(),
});

export const parseResultSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    parsedAt: z.string(),
    parserVersion: z.string(),
    source: z.object({
      filePath: z.string(),
      fileName: z.string(),
      fileFormat: z.enum(['pdf', 'jpg', 'png', 'xlsx', 'xls', 'doc', 'docx']),
      fileSizeMB: z.number().nonnegative(),
      fileHash: z.string().regex(/^[a-f0-9]{64}$/),
      pageCount: z.number().int().optional(),
      sheetNames: z.array(z.string()).optional(),
      truncated: z.boolean(),
      pagesIncluded: z.array(z.number().int()).optional(),
      uploadedAt: z.string(),
    }),
    raw: z.object({
      pages: z.array(z.unknown()).optional(),
      sheets: z.array(z.unknown()).optional(),
      sections: z.array(z.unknown()).optional(),
      fullText: z.string().optional(),
      seals: z.array(z.unknown()).optional(),
      signatures: z.array(z.unknown()).optional(),
    }),
    extracted: z.record(z.string(), extractedFieldSchema).optional(),
    metrics: z.unknown(),
    warnings: z.array(z.string()).optional(),
  })
  .describe('ParseResult');

export function getParseResultJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(parseResultSchema, { name: 'ParseResult' }) as Record<string, unknown>;
}
