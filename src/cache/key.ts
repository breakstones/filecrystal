import { sha256String } from '../extractors/utils/file-hash.js';

export function buildCacheKey(fileHash: string, configFingerprint: string, promptHash?: string): string {
  const parts = [fileHash, configFingerprint];
  if (promptHash) parts.push(promptHash);
  return sha256String(parts.join('|')).slice(0, 16) + '-' + fileHash.slice(0, 12);
}

export function fingerprintConfig(obj: Record<string, unknown>): string {
  return sha256String(JSON.stringify(obj)).slice(0, 12);
}
