import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildXlsx, buildZipFixture, ensureDir, fixturesDir } from '../helpers/fixtures.js';
import { createFileParser, createStructuredExtractor, toStructureSource } from '../../src/index.js';
import { classifyInputs } from '../../src/utils/archive.js';

const cliPath = resolve('dist/cli.js');
let outDir: string;

beforeAll(() => {
  ensureDir();
  buildXlsx(join(fixturesDir, 'cli-a.xlsx'));
  buildXlsx(join(fixturesDir, 'cli-b.xlsx'));
  outDir = mkdtempSync(join(tmpdir(), 'filecrystal-cli-'));
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('filecrystal CLI · help surface', () => {
  it('top-level --help lists only `extract` and `structure`', () => {
    if (!existsSync(cliPath)) return; // skip if not yet built
    const out = execFileSync('node', [cliPath, '--help'], { encoding: 'utf8' });
    expect(out).toMatch(/extract \[options\]/);
    expect(out).toMatch(/structure \[options\]/);
    expect(out).not.toMatch(/parse \[options\]/);
    expect(out).not.toMatch(/\bschema\b/);
  });

  it('extract --help shows --vision-model and no --ocr-model / --format / --mode', () => {
    if (!existsSync(cliPath)) return;
    const out = execFileSync('node', [cliPath, 'extract', '--help'], { encoding: 'utf8' });
    expect(out).toMatch(/--vision-model/);
    expect(out).not.toMatch(/--ocr-model/);
    expect(out).not.toMatch(/--format/);
    expect(out).not.toMatch(/--mode/);
    expect(out).not.toMatch(/--pretty/);
  });

  it('structure --help shows --prompt and --prompt-text, no --mode / --pretty', () => {
    if (!existsSync(cliPath)) return;
    const out = execFileSync('node', [cliPath, 'structure', '--help'], { encoding: 'utf8' });
    expect(out).toMatch(/--prompt\b/);
    expect(out).toMatch(/--prompt-text\b/);
    expect(out).not.toMatch(/--mode/);
    expect(out).not.toMatch(/--pretty/);
  });
});

// Library-level smoke: mock mode still works through the public API,
// even though the CLI only exposes api mode.
describe('library smoke (mock mode)', () => {
  it('parser.parse on an xlsx fixture returns a ParseResult', async () => {
    const parser = createFileParser({ mode: 'mock' });
    const result = await parser.parse(join(fixturesDir, 'cli-a.xlsx'));
    expect(result.schemaVersion).toBe('1.0');
    expect(result.source.fileFormat).toBe('xlsx');
    expect(Array.isArray(result.raw.sheets)).toBe(true);
  });

  it('structuredExtractor.extract passes prompt output verbatim', async () => {
    const parser = createFileParser({ mode: 'mock' });
    const raw = await parser.parse(join(fixturesDir, 'cli-a.xlsx'));
    const extractor = createStructuredExtractor({ mode: 'mock' });
    const res = await extractor.extract([toStructureSource(raw)]);
    expect(res.promptName).toBeDefined();
    expect(typeof res.extracted).toBe('object');
    expect(res.batches).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// classifyInputs — CLI pre-processor integration
// Exercises the extract input pipeline without needing real API credentials.
// ─────────────────────────────────────────────────────────────────────────
describe('filecrystal extract · classifyInputs (zip + passthrough + mixed)', () => {
  let scratch: string;
  let xlsxBuf: Buffer;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'filecrystal-classify-'));
    // Re-use the committed xlsx fixture as a payload we can embed.
    if (!existsSync(join(fixturesDir, 'cli-a.xlsx'))) buildXlsx(join(fixturesDir, 'cli-a.xlsx'));
    xlsxBuf = await readFile(join(fixturesDir, 'cli-a.xlsx'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('pure zip: 2 xlsx entries become 2 parse inputs, deterministic order', async () => {
    const zipPath = join(scratch, 'pure.zip');
    await buildZipFixture(zipPath, {
      'b.xlsx': xlsxBuf,
      'a.xlsx': xlsxBuf,
    });

    const r = await classifyInputs([zipPath]);
    expect(r.parseInputs).toHaveLength(2);
    // sorted alphabetically
    expect(r.parseInputs[0]!.endsWith('a.xlsx')).toBe(true);
    expect(r.parseInputs[1]!.endsWith('b.xlsx')).toBe(true);
    expect(r.passthroughInputs).toHaveLength(0);
    expect(r.archives).toHaveLength(1);
    expect(r.archives[0]!.expanded).toBe(2);
    expect(r.archives[0]!.passthrough).toBe(0);
    expect(r.slots).toHaveLength(2);
    expect(r.slots.every((s) => s.origin === 0)).toBe(true);
  });

  it('mixed: pdf + zip preserves user order, zip entries slotted after parent', async () => {
    const xlsxA = join(fixturesDir, 'cli-a.xlsx');
    const zipPath = join(scratch, 'mixed.zip');
    await buildZipFixture(zipPath, {
      'x1.xlsx': xlsxBuf,
      'x2.xlsx': xlsxBuf,
    });

    const r = await classifyInputs([xlsxA, zipPath]);
    expect(r.parseInputs).toHaveLength(3);
    expect(r.parseInputs[0]).toBe(xlsxA);
    expect(r.parseInputs[1]!.endsWith('x1.xlsx')).toBe(true);
    expect(r.parseInputs[2]!.endsWith('x2.xlsx')).toBe(true);
    expect(r.archives).toHaveLength(1);

    // slot ordering: origin 0 sub 0, origin 1 sub 1, origin 1 sub 2
    expect(r.slots[0]).toMatchObject({ origin: 0, sub: 0, kind: 'parse' });
    expect(r.slots[1]).toMatchObject({ origin: 1, sub: 1, kind: 'parse' });
    expect(r.slots[2]).toMatchObject({ origin: 1, sub: 2, kind: 'parse' });
  });

  it('text passthrough: standalone .md/.txt never become parse inputs', async () => {
    const md = join(scratch, 'notes.md');
    const txt = join(scratch, 'memo.txt');
    writeFileSync(md, '# hi\n');
    writeFileSync(txt, 'plain\n');

    const r = await classifyInputs([md, txt]);
    expect(r.parseInputs).toHaveLength(0);
    expect(r.passthroughInputs).toEqual([md, txt]);
    expect(r.archives).toHaveLength(0);
    expect(r.slots).toHaveLength(2);
    expect(r.slots.every((s) => s.kind === 'passthrough')).toBe(true);
  });

  it('zip with .md / .txt entries: they land in passthroughInputs, not parseInputs', async () => {
    const zipPath = join(scratch, 'with-text.zip');
    await buildZipFixture(zipPath, {
      'data.xlsx': xlsxBuf,
      'README.md': Buffer.from('# doc', 'utf8'),
      'notes.txt': Buffer.from('hello', 'utf8'),
    });

    const r = await classifyInputs([zipPath]);
    expect(r.parseInputs).toHaveLength(1);
    expect(r.parseInputs[0]!.endsWith('data.xlsx')).toBe(true);
    expect(r.passthroughInputs).toHaveLength(2);
    expect(r.passthroughInputs.some((p) => p.endsWith('README.md'))).toBe(true);
    expect(r.passthroughInputs.some((p) => p.endsWith('notes.txt'))).toBe(true);
    expect(r.archives[0]).toMatchObject({ expanded: 1, passthrough: 2 });
    // All disk files exist
    for (const p of [...r.parseInputs, ...r.passthroughInputs]) {
      expect(existsSync(p)).toBe(true);
    }
  });

  it('full mixed: external md + external pdf-surrogate + zip → correct ordering', async () => {
    // We use an xlsx in place of a "pdf" to avoid shipping a tmp pdf.
    const extMd = join(scratch, 'foreword.md');
    writeFileSync(extMd, '# foreword\n');
    const extXlsx = join(fixturesDir, 'cli-a.xlsx');
    const zipPath = join(scratch, 'mix-full.zip');
    await buildZipFixture(zipPath, {
      'readme.txt': Buffer.from('ignored as passthrough', 'utf8'),
      'data.xlsx': xlsxBuf,
    });

    const r = await classifyInputs([extMd, extXlsx, zipPath]);

    // passthrough paths: the external md, and the zip's readme.txt
    expect(r.passthroughInputs).toHaveLength(2);
    expect(r.passthroughInputs[0]).toBe(extMd);
    expect(r.passthroughInputs[1]!.endsWith('readme.txt')).toBe(true);

    // parse paths: external xlsx, zip's data.xlsx
    expect(r.parseInputs).toHaveLength(2);
    expect(r.parseInputs[0]).toBe(extXlsx);
    expect(r.parseInputs[1]!.endsWith('data.xlsx')).toBe(true);

    // Slot order: md(0), xlsx(1), zip-data.xlsx(2,1), zip-readme.txt(2,2)
    expect(r.slots.map((s) => [s.origin, s.sub, s.kind])).toEqual([
      [0, 0, 'passthrough'],
      [1, 0, 'parse'],
      [2, 1, 'parse'],
      [2, 2, 'passthrough'],
    ]);
  });

  it('empty parseInputs: single .md input produces 1 passthrough slot and 0 parse inputs', async () => {
    const md = join(scratch, 'only.md');
    writeFileSync(md, '# hi');
    const r = await classifyInputs([md]);
    expect(r.parseInputs).toEqual([]);
    expect(r.passthroughInputs).toEqual([md]);
    expect(r.slots).toHaveLength(1);
  });
});

// Dummy reference to keep `outDir` in scope; a CLI smoke that exercises the
// api path would require real credentials and is covered by `tests/reports`
// benchmark runs instead.
void outDir;
void readFileSync;
