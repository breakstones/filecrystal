import { describe, expect, it } from 'vitest';
import { createFileParser } from '../../src/index.js';
import { FileParserError, ErrorCode } from '../../src/utils/errors.js';

describe('error paths', () => {
  it('throws ERR_FILE_NOT_FOUND when the file is missing', async () => {
    const parser = createFileParser({ mode: 'mock' });
    try {
      await parser.parse('./does-not-exist.pdf');
      throw new Error('expected parse to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(FileParserError);
      expect((err as FileParserError).code).toBe(ErrorCode.FILE_NOT_FOUND);
    }
  });

  it('throws ERR_UNSUPPORTED_FORMAT for an unknown extension', async () => {
    const parser = createFileParser({ mode: 'mock' });
    try {
      await parser.parse('./some.rtf');
      throw new Error('expected parse to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(FileParserError);
      expect((err as FileParserError).code).toBe(ErrorCode.UNSUPPORTED_FORMAT);
    }
  });
});
