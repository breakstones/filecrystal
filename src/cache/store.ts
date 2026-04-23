import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
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
      // Unique tmp path per writer — different keys never collide, same-key
      // writers only race at the final rename (atomic on both POSIX and NTFS).
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
        .toString(36)
        .slice(2, 10)}.tmp`;
      await writeFile(tmpPath, JSON.stringify(value), 'utf8');
      await rename(tmpPath, filePath);
    },
  };
}
