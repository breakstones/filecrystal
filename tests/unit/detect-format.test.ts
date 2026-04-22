import { describe, expect, it } from 'vitest';
import { detectFormat } from '../../src/extractors/index.js';
import { FileParserError } from '../../src/utils/errors.js';

describe('detectFormat', () => {
  it('maps common extensions', () => {
    expect(detectFormat('x.pdf')).toBe('pdf');
    expect(detectFormat('x.xlsx')).toBe('xlsx');
    expect(detectFormat('x.xls')).toBe('xls');
    expect(detectFormat('x.jpg')).toBe('jpg');
    expect(detectFormat('x.JPEG')).toBe('jpg');
    expect(detectFormat('x.docx')).toBe('docx');
    expect(detectFormat('x.doc')).toBe('doc');
    expect(detectFormat('x.png')).toBe('png');
  });

  it('throws for unsupported extension', () => {
    expect(() => detectFormat('a.rtf')).toThrow(FileParserError);
  });
});
