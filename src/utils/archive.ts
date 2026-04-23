import JSZip from 'jszip';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { FileParserError, ErrorCode } from './errors.js';

/** Extensions that go through the normal parse pipeline (OCR / xlsx / docx / image). */
const PARSED_EXTS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.xlsx',
  '.xls',
  '.doc',
  '.docx',
]);

/** Extensions treated as already-text; they pass through summary without hitting the parser. */
const TEXT_PASSTHROUGH_EXTS = new Set(['.md', '.markdown', '.txt']);

/** Archive formats recognised by the pre-processor. */
const ARCHIVE_EXTS = new Set(['.zip']);

/** Entries whose basename matches this are skipped entirely (Mac/Windows cruft). */
const IGNORED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db']);

export function isArchive(path: string): boolean {
  return ARCHIVE_EXTS.has(extname(path).toLowerCase());
}

export function isTextPassthrough(path: string): boolean {
  return TEXT_PASSTHROUGH_EXTS.has(extname(path).toLowerCase());
}

export function isParsedFormat(path: string): boolean {
  return PARSED_EXTS.has(extname(path).toLowerCase());
}

export interface ExpandedArchive {
  /** Original archive file path. */
  archivePath: string;
  /** `<dirname(archivePath)>/<stem(archivePath)>/` — absolute path where entries landed. */
  extractedDir: string;
  /** Absolute paths of entries in PARSED_EXTS; feed these to parseMany. */
  files: string[];
  /** Absolute paths of entries in TEXT_PASSTHROUGH_EXTS; surface as passthrough items. */
  textFiles: string[];
  /** Unsupported entries (neither parsed nor text nor archive) that were written but won't be processed. */
  skipped: string[];
  /** Human-readable notes (e.g. nested archives left un-recursed). */
  warnings: string[];
}

/**
 * Expand a `.zip` into a same-named sibling directory and classify its
 * contents by extension. Rejects path-traversal (`..`) and absolute-path
 * entries to defend against zip-slip.
 *
 * Nested zips are written to disk but NOT recursed — each produces a
 * warning. The user can explicitly invoke the CLI on the nested zip
 * if they want it expanded.
 */
export async function expandZip(archivePath: string): Promise<ExpandedArchive> {
  const stem = basename(archivePath).replace(/\.zip$/i, '');
  const extractedDir = resolve(dirname(archivePath), stem);
  await mkdir(extractedDir, { recursive: true });

  const buffer = await readFile(archivePath);
  const zip = await JSZip.loadAsync(buffer);

  const files: string[] = [];
  const textFiles: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  // Sort entry names up-front so output ordering is deterministic across runs
  // (same cache keys, reproducible tests).
  const entryNames = Object.keys(zip.files).sort();

  for (const entryName of entryNames) {
    const entry = zip.files[entryName]!;
    if (entry.dir) continue;

    // Reject path-traversal / absolute paths (zip-slip guard).
    if (isAbsolute(entryName) || entryName.includes('..')) {
      throw new FileParserError(
        ErrorCode.UNSUPPORTED_FORMAT,
        `Rejected zip entry with unsafe path: ${entryName}`,
        { archivePath },
      );
    }

    // Strip common Mac/Windows cruft.
    if (entryName.startsWith('__MACOSX/')) continue;
    const base = basename(entryName);
    if (IGNORED_BASENAMES.has(base)) continue;
    if (base.startsWith('.DS_Store')) continue;

    // Double-guard: resolved path must stay under extractedDir.
    const outPath = resolve(extractedDir, entryName);
    if (!outPath.startsWith(extractedDir + (process.platform === 'win32' ? '\\' : '/'))) {
      // Allow equality (the directory itself). Any jump outside is a zip-slip.
      if (outPath !== extractedDir) {
        throw new FileParserError(
          ErrorCode.UNSUPPORTED_FORMAT,
          `Rejected zip entry that escapes the extraction root: ${entryName}`,
          { archivePath, outPath, extractedDir },
        );
      }
    }

    await mkdir(dirname(outPath), { recursive: true });
    const data = await entry.async('nodebuffer');
    await writeFile(outPath, data);

    const ext = extname(entryName).toLowerCase();
    if (PARSED_EXTS.has(ext)) {
      files.push(outPath);
    } else if (TEXT_PASSTHROUGH_EXTS.has(ext)) {
      textFiles.push(outPath);
    } else if (ARCHIVE_EXTS.has(ext)) {
      warnings.push(`nested archive ${outPath} was not recursed`);
    } else {
      skipped.push(outPath);
    }
  }

  files.sort();
  textFiles.sort();
  skipped.sort();

  return { archivePath, extractedDir, files, textFiles, skipped, warnings };
}

/** Summary-of-archive entry reported back to the CLI layer. */
export interface ArchiveSummary {
  archive: string;
  extractedDir: string;
  expanded: number;    // count of parsed-format entries
  passthrough: number; // count of text-passthrough entries
  warnings: string[];
}

/** One slot in the final ordering: user's original index + within-archive order. */
export interface InputSlot {
  origin: number;  // 0-based index in user-supplied paths
  sub: number;     // 0 for the original path itself, >0 for entries extracted from it
  path: string;
  kind: 'parse' | 'passthrough' | 'archive-failed';
  /** Populated when kind='archive-failed'. */
  error?: string;
  code?: string;
}

export interface ClassifiedInputs {
  slots: InputSlot[];
  parseInputs: string[];
  passthroughInputs: string[];
  archives: ArchiveSummary[];
}

/**
 * Pre-process `filecrystal extract` arguments:
 *   - expand any `.zip` into a same-named sibling directory,
 *   - route `.md / .markdown / .txt` into the passthrough list,
 *   - everything else into the parse list.
 *
 * Returns `slots` that preserve the user's original order plus deterministic
 * ordering of archive-extracted entries (alphabetical by sorted entry name).
 * The caller uses `slots` to assemble the final summary.items[] in order.
 */
export async function classifyInputs(paths: string[]): Promise<ClassifiedInputs> {
  const slots: InputSlot[] = [];
  const parseInputs: string[] = [];
  const passthroughInputs: string[] = [];
  const archives: ArchiveSummary[] = [];

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]!;
    if (isArchive(p)) {
      let exp: ExpandedArchive;
      try {
        exp = await expandZip(p);
      } catch (err) {
        const e = err as { message?: string; code?: string };
        const slot: InputSlot = {
          origin: i,
          sub: 0,
          path: p,
          kind: 'archive-failed',
          error: e?.message ?? String(err),
        };
        if (e?.code) slot.code = e.code;
        slots.push(slot);
        continue;
      }
      archives.push({
        archive: p,
        extractedDir: exp.extractedDir,
        expanded: exp.files.length,
        passthrough: exp.textFiles.length,
        warnings: exp.warnings,
      });
      const zipEntries: Array<{ path: string; kind: 'parse' | 'passthrough' }> = [
        ...exp.files.map((f) => ({ path: f, kind: 'parse' as const })),
        ...exp.textFiles.map((f) => ({ path: f, kind: 'passthrough' as const })),
      ].sort((a, b) => a.path.localeCompare(b.path));
      for (let j = 0; j < zipEntries.length; j++) {
        const e = zipEntries[j]!;
        slots.push({ origin: i, sub: j + 1, path: e.path, kind: e.kind });
        if (e.kind === 'parse') parseInputs.push(e.path);
        else passthroughInputs.push(e.path);
      }
    } else if (isTextPassthrough(p)) {
      slots.push({ origin: i, sub: 0, path: p, kind: 'passthrough' });
      passthroughInputs.push(p);
    } else {
      slots.push({ origin: i, sub: 0, path: p, kind: 'parse' });
      parseInputs.push(p);
    }
  }

  // The caller renders items in (origin, sub) order.
  slots.sort((a, b) => a.origin - b.origin || a.sub - b.sub);

  return { slots, parseInputs, passthroughInputs, archives };
}
