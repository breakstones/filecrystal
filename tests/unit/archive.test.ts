import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { writeFile } from 'node:fs/promises';
import { expandZip, isArchive, isTextPassthrough, isParsedFormat } from '../../src/utils/archive.js';
import { FileParserError } from '../../src/utils/errors.js';
import { buildZipFixture, buildXlsx, fixturesDir, ensureDir } from '../helpers/fixtures.js';

let scratchDir: string;

beforeAll(() => {
  ensureDir();
  scratchDir = mkdtempSync(join(tmpdir(), 'filecrystal-archive-'));
});

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe('archive predicates', () => {
  it('classifies extensions', () => {
    expect(isArchive('x.zip')).toBe(true);
    expect(isArchive('x.ZIP')).toBe(true);
    expect(isArchive('x.pdf')).toBe(false);

    expect(isTextPassthrough('notes.md')).toBe(true);
    expect(isTextPassthrough('note.MARKDOWN')).toBe(true);
    expect(isTextPassthrough('memo.txt')).toBe(true);
    expect(isTextPassthrough('a.pdf')).toBe(false);

    expect(isParsedFormat('a.pdf')).toBe(true);
    expect(isParsedFormat('a.xlsx')).toBe(true);
    expect(isParsedFormat('a.md')).toBe(false);
    expect(isParsedFormat('a.zip')).toBe(false);
  });
});

describe('expandZip — classification + extraction', () => {
  it('separates parsed / text / skipped / nested-archive entries', async () => {
    const xlsxSrc = join(fixturesDir, 'cli-sample.xlsx');
    if (!existsSync(xlsxSrc)) buildXlsx(xlsxSrc);
    const xlsxBuf = await (await import('node:fs/promises')).readFile(xlsxSrc);

    const zipPath = join(scratchDir, 'bundle.zip');
    // Build nested zip in memory first
    const inner = new JSZip();
    inner.file('child.txt', Buffer.from('inner', 'utf8'));
    const innerBuf = await inner.generateAsync({ type: 'nodebuffer' });

    await buildZipFixture(zipPath, {
      'a.xlsx': xlsxBuf,
      'b.txt': Buffer.from('hello text', 'utf8'),
      'c.md': Buffer.from('# hi', 'utf8'),
      'd.unknown': Buffer.from('??', 'utf8'),
      'nested.zip': innerBuf,
    });

    const result = await expandZip(zipPath);

    expect(result.archivePath).toBe(zipPath);
    expect(result.extractedDir.endsWith('bundle')).toBe(true);

    // parsed: a.xlsx
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.endsWith('a.xlsx')).toBe(true);
    expect(existsSync(result.files[0]!)).toBe(true);

    // text: b.txt + c.md
    expect(result.textFiles.length).toBe(2);
    expect(result.textFiles.some((p) => p.endsWith('b.txt'))).toBe(true);
    expect(result.textFiles.some((p) => p.endsWith('c.md'))).toBe(true);
    // Actual bytes of each text file stay on disk
    for (const p of result.textFiles) expect(existsSync(p)).toBe(true);

    // skipped: d.unknown
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]!.endsWith('d.unknown')).toBe(true);
    expect(existsSync(result.skipped[0]!)).toBe(true); // still on disk

    // nested archive → warning, NOT in files/textFiles
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/nested archive .* was not recursed/);
    expect(result.files.some((p) => p.endsWith('nested.zip'))).toBe(false);
    expect(result.textFiles.some((p) => p.endsWith('nested.zip'))).toBe(false);
  });

  it('skips macOS / Windows cruft (__MACOSX/, .DS_Store, Thumbs.db)', async () => {
    const zipPath = join(scratchDir, 'cruft.zip');
    const realXlsx = join(fixturesDir, 'cli-sample.xlsx');
    if (!existsSync(realXlsx)) buildXlsx(realXlsx);
    const xlsxBuf = await (await import('node:fs/promises')).readFile(realXlsx);

    await buildZipFixture(zipPath, {
      'real.xlsx': xlsxBuf,
      '__MACOSX/ignored.txt': Buffer.from('x', 'utf8'),
      '.DS_Store': Buffer.from('x', 'utf8'),
      'subdir/.DS_Store': Buffer.from('x', 'utf8'),
      'Thumbs.db': Buffer.from('x', 'utf8'),
    });

    const result = await expandZip(zipPath);
    expect(result.files.length).toBe(1);
    expect(result.files[0]!.endsWith('real.xlsx')).toBe(true);
    expect(result.textFiles.length).toBe(0);
    expect(result.skipped.length).toBe(0);
    // Cruft entries are not written to disk either
    expect(existsSync(join(result.extractedDir, '__MACOSX'))).toBe(false);
    expect(existsSync(join(result.extractedDir, '.DS_Store'))).toBe(false);
  });

  it('rejects zip-slip: absolute-path entries', async () => {
    // JSZip's `generateAsync` normalises `../` out when serialising, but
    // leaves absolute paths intact. A maliciously-crafted zip from another
    // tool could still embed `..`; our code rejects both. Here we test
    // the absolute-path branch (the `..` branch is defensive belt-and-
    // suspenders against non-JSZip producers — we trust the code path
    // without a test that can't be reliably constructed with JSZip).
    const zipPath = join(scratchDir, 'abs.zip');
    const zip = new JSZip();
    zip.file('/etc/passwd', Buffer.from('gotcha', 'utf8'));
    await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(expandZip(zipPath)).rejects.toBeInstanceOf(FileParserError);
  });

  it('produces deterministic file ordering across runs', async () => {
    const zipPath = join(scratchDir, 'order.zip');
    const xlsxBuf = await (await import('node:fs/promises')).readFile(
      join(fixturesDir, 'cli-sample.xlsx'),
    );
    await buildZipFixture(zipPath, {
      'z.xlsx': xlsxBuf,
      'a.xlsx': xlsxBuf,
      'm.xlsx': xlsxBuf,
    });

    const r1 = await expandZip(zipPath);
    const r2 = await expandZip(zipPath);
    expect(r1.files).toEqual(r2.files);
    // Lexically sorted
    const bases = r1.files.map((p) => p.split(/[\\/]/).pop());
    expect(bases).toEqual(['a.xlsx', 'm.xlsx', 'z.xlsx']);
  });
});
