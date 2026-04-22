import { describe, expect, it } from 'vitest';
import { getParseResultJsonSchema } from '../../src/schema/index.js';

describe('getParseResultJsonSchema', () => {
  it('returns a JSON Schema object describing ParseResult', () => {
    const schema = getParseResultJsonSchema();
    expect(schema).toBeTypeOf('object');
    expect(JSON.stringify(schema)).toContain('ParseResult');
  });
});
