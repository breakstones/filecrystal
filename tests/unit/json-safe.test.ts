import { describe, expect, it } from 'vitest';
import { safeJsonParse } from '../../src/utils/json.js';

describe('safeJsonParse', () => {
  it('parses plain JSON', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('unwraps fenced JSON blocks', () => {
    const raw = '```json\n{"ok": true}\n```';
    expect(safeJsonParse<{ ok: boolean }>(raw)).toEqual({ ok: true });
  });

  it('recovers the first balanced braces when wrapped in narration', () => {
    const raw = 'Here is the JSON:\n{"x": 1}\nthanks';
    expect(safeJsonParse<{ x: number }>(raw)).toEqual({ x: 1 });
  });

  it('recovers an array payload when it appears before any object', () => {
    const raw = 'Output: [1, 2, 3]';
    expect(safeJsonParse<number[]>(raw)).toEqual([1, 2, 3]);
  });

  it('throws when no JSON can be found', () => {
    expect(() => safeJsonParse('literally nothing parseable')).toThrow();
  });
});
