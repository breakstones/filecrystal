import { describe, expect, it } from 'vitest';
import { FileParserError, ErrorCode } from '../../src/utils/errors.js';

describe('FileParserError', () => {
  it('exposes code and details', () => {
    const err = new FileParserError(ErrorCode.UNSUPPORTED_FORMAT, 'nope', { ext: '.zip' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FileParserError');
    expect(err.code).toBe('ERR_UNSUPPORTED_FORMAT');
    expect(err.details).toEqual({ ext: '.zip' });
  });

  it('exports the full error code enum', () => {
    expect(ErrorCode.LLM_JSON_PARSE).toBe('ERR_LLM_JSON_PARSE');
    expect(Object.keys(ErrorCode).length).toBeGreaterThan(5);
  });
});
