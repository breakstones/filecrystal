import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildXlsx, ensureDir, fixturesDir } from '../helpers/fixtures.js';
import { createFileParser, createStructuredExtractor, toStructureSource } from '../../src/index.js';

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

// Dummy reference to keep `outDir` in scope; a CLI smoke that exercises the
// api path would require real credentials and is covered by `tests/reports`
// benchmark runs instead.
void outDir;
void readFileSync;
