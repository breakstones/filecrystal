import pLimit from 'p-limit';

export function createLimiter(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const limit = pLimit(Math.max(1, concurrency));
  return <T>(fn: () => Promise<T>) => limit(fn);
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseMs?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const baseMs = options.baseMs ?? 500;
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = baseMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
    }
  }
  throw lastErr;
}
