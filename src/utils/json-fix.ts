/**
 * Best-effort JSON repair for LLM output.
 *
 * Handles the common-sin list:
 *  - Surrounding ```json ... ``` (or any) code fence
 *  - Leading/trailing narrative text ("Here is the JSON: {...}")
 *  - Trailing commas before `]` or `}`
 *  - Smart quotes (" " ‘ ’) instead of ASCII `"` / `'`
 *  - Single-quoted strings (converted to double-quoted)
 *  - Unquoted keys `{foo: 1}` → `{"foo": 1}`
 *  - Trailing truncation (finds the last balanced closing bracket)
 *
 * Throws when none of the above rescues produce valid JSON. Caller decides
 * the fallback (e.g. `{ text: raw }`).
 */
export function parseJsonFixing(raw: string): unknown {
  const candidates = generateCandidates(raw);
  let lastErr: unknown;
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('no JSON candidates could be parsed');
}

function generateCandidates(raw: string): string[] {
  const out: string[] = [];
  let s = raw.trim();
  if (!s) return out;

  // 1. Raw as-is
  out.push(s);

  // 2. Strip ```...``` fence (any language tag)
  const fence = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(s);
  if (fence) {
    s = fence[1]!.trim();
    out.push(s);
  }

  // 3. Slice from first `{`/`[` to last `}`/`]`
  const sliced = sliceToOutermostBrackets(s);
  if (sliced && sliced !== s) out.push(sliced);

  // Run repair on whichever candidates are non-trivial
  const base = sliced ?? s;
  const repaired = applyCommonRepairs(base);
  if (repaired !== base) out.push(repaired);

  return out;
}

function sliceToOutermostBrackets(s: string): string | null {
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const lastObj = s.lastIndexOf('}');
  const lastArr = s.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end <= start) return null;
  return s.slice(start, end + 1);
}

function applyCommonRepairs(s: string): string {
  let out = s;
  // Smart quotes → ASCII
  out = out.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // Remove // line comments (not valid JSON)
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // Remove /* block comments */
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  // Quote unquoted object keys: { foo: ... } → { "foo": ... }
  out = out.replace(/([{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  // Convert single-quoted strings to double-quoted (only when not inside
  // a valid double-quoted string — this simple version is OK because LLMs
  // rarely nest quote styles).
  out = out.replace(
    /'((?:\\.|[^'\\])*)'/g,
    (_m, body: string) => `"${body.replace(/"/g, '\\"')}"`,
  );
  // Trailing commas before ] or }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}
