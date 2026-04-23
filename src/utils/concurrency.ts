import pLimit from 'p-limit';

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createLimiter(concurrency: number): Limiter {
  const limit = pLimit(Math.max(1, concurrency));
  return <T>(fn: () => Promise<T>) => limit(fn);
}

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  /** Cap on computed backoff (before jitter). Default 15_000. */
  maxMs?: number;
}

/**
 * Structured retry with:
 *  - Full-jitter exponential backoff (AWS-style) → avoids thundering herd
 *    when many concurrent workers hit the same 429.
 *  - Honour the server's Retry-After header (seconds or HTTP date) on 429/503.
 *  - Fast retry on network-layer errors (ECONNRESET/ETIMEDOUT/ECONNREFUSED).
 *  - Don't retry client-side programmer errors (4xx other than 408/425/429).
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const baseMs = options.baseMs ?? 500;
  const maxMs = options.maxMs ?? 15_000;
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      if (!isRetryable(err)) break;
      const delay = computeDelay(err, attempt, baseMs, maxMs);
      await sleep(delay);
      attempt++;
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  const status = statusOf(err);
  if (status === undefined) {
    // Network-level error (e.g. ECONNRESET) → always retryable
    const code = (err as { code?: string })?.code;
    if (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'EAI_AGAIN' ||
      code === 'ENOTFOUND'
    ) {
      return true;
    }
    // openai SDK wraps network errors without status — treat as retryable.
    return true;
  }
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; response?: { status?: number } };
  return e?.status ?? e?.response?.status;
}

function computeDelay(err: unknown, attempt: number, baseMs: number, maxMs: number): number {
  const ra = retryAfterMs(err);
  if (ra !== undefined) return Math.min(ra, maxMs);
  // Full-jitter exponential: delay ∈ [0, min(maxMs, base * 2^attempt)]
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

function retryAfterMs(err: unknown): number | undefined {
  const headers = (err as { response?: { headers?: Record<string, string> }; headers?: Record<string, string> })
    ?.response?.headers ?? (err as { headers?: Record<string, string> })?.headers;
  if (!headers) return undefined;
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return undefined;
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) return asNum * 1000;
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
