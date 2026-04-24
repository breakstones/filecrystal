import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Package version resolved at runtime from the shipped `package.json`.
 *
 * Layout guarantees this always resolves:
 *   dev (tsx / vitest): `src/version.ts`  → `../package.json` is the repo root
 *   built bundle:       `dist/*.{js,cjs}` → `../package.json` is the package root
 * npm always includes `package.json` in the tarball regardless of the `files`
 * whitelist, so the lookup never fails post-publish.
 */
function resolveVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    const raw = readFileSync(fileURLToPath(url), 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION: string = resolveVersion();
