import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import * as XLSX from 'xlsx';

export const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

export function ensureDir(): void {
  mkdirSync(fixturesDir, { recursive: true });
}

export async function buildTextPdf(
  path: string,
  pages: string[] = [
    'Hello world on page 1. Contract Name: Alpha Project.',
    'Page 2 body with amount 500000.',
    'Final page signatures and totals.',
  ],
): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 50, y: 720, size: 14, font });
  }
  writeFileSync(path, await doc.save());
}

export async function buildBlankPdf(path: string, pageCount = 2): Promise<void> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([612, 792]);
  writeFileSync(path, await doc.save());
}

export async function buildLongPdf(path: string, pageCount = 15): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Long doc page ${i} content line with details.`, {
      x: 50,
      y: 720,
      size: 14,
      font,
    });
  }
  writeFileSync(path, await doc.save());
}

export async function buildDocx(
  path: string,
  paragraphs: string[] = [
    'First paragraph hello world.',
    'Second paragraph with amount 1,234,567.',
    'Third paragraph signed by Alice.',
  ],
): Promise<void> {
  const doc = new Document({
    sections: [
      {
        children: paragraphs.map((text) => new Paragraph({ children: [new TextRun(text)] })),
      },
    ],
  });
  const buf = await Packer.toBuffer(doc);
  writeFileSync(path, buf);
}

export function buildXlsx(path: string): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['项目', '金额'],
    ['A', 100],
    ['B', 200],
    ['合计', 300],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '汇总');
  writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

export async function ensureAllFixtures(): Promise<void> {
  ensureDir();
  const textPdf = join(fixturesDir, 'text.pdf');
  if (!existsSync(textPdf)) await buildTextPdf(textPdf);
  const blankPdf = join(fixturesDir, 'blank.pdf');
  if (!existsSync(blankPdf)) await buildBlankPdf(blankPdf);
  const longPdf = join(fixturesDir, 'long.pdf');
  if (!existsSync(longPdf)) await buildLongPdf(longPdf);
  const docx = join(fixturesDir, 'simple.docx');
  if (!existsSync(docx)) await buildDocx(docx);
  const xlsx = join(fixturesDir, 'sample.xlsx');
  if (!existsSync(xlsx)) buildXlsx(xlsx);
}
