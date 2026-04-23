/**
 * Tolerant JSON parser for LLM responses.
 *
 * Even when callers pass `response_format: json_object`, provider responses
 * occasionally include:
 *  - Markdown code fences (```json ... ```)
 *  - Leading/trailing narration ("Here is the JSON: { ... }")
 *  - Trailing commas
 *
 * `safeJsonParse` recovers the first balanced `{...}` or `[...]` block in
 * `content`, strips obvious wrappers, and retries JSON.parse. Throws only
 * when no recognisable JSON can be found.
 */
export function safeJsonParse<T = unknown>(content: string): T {
  const raw = content.trim();
  const attempts: string[] = [raw];

  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw);
  if (fence?.[1]) attempts.push(fence[1].trim());

  const firstBrace = raw.indexOf('{');
  const firstBracket = raw.indexOf('[');
  const firstIdx =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (firstIdx > 0) {
    const lastBrace = raw.lastIndexOf('}');
    const lastBracket = raw.lastIndexOf(']');
    const lastIdx = Math.max(lastBrace, lastBracket);
    if (lastIdx > firstIdx) attempts.push(raw.slice(firstIdx, lastIdx + 1));
  }

  let lastErr: unknown;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('no parseable JSON payload');
}
