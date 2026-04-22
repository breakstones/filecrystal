import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { ParseResult } from '../types.js';

export interface CacheStore {
  get(key: string): Promise<ParseResult | null>;
  put(key: string, value: ParseResult): Promise<void>;
}

export function createFileCacheStore(cacheDir: string): CacheStore {
  return {
    async get(key) {
      try {
        const filePath = join(cacheDir, `${key}.json`);
        const buf = await readFile(filePath, 'utf8');
        return JSON.parse(buf) as ParseResult;
      } catch {
        return null;
      }
    },
    async put(key, value) {
      await mkdir(cacheDir, { recursive: true });
      const filePath = join(cacheDir, `${key}.json`);
      const tmpPath = `${filePath}.tmp`;
      let release: (() => Promise<void>) | undefined;
      try {
        release = await lockfile.lock(cacheDir, { retries: 3, realpath: false });
        await writeFile(tmpPath, JSON.stringify(value), 'utf8');
        await rename(tmpPath, filePath);
      } finally {
        if (release) await release();
      }
    },
  };
}
