import { extname } from 'node:path';
import type { FileFormat } from '../types.js';
import { FileParserError, ErrorCode } from '../utils/errors.js';

const EXT_TO_FORMAT: Record<string, FileFormat> = {
  '.pdf': 'pdf',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.png': 'png',
  '.xlsx': 'xlsx',
  '.xls': 'xls',
  '.doc': 'doc',
  '.docx': 'docx',
};

export function detectFormat(filePath: string): FileFormat {
  const ext = extname(filePath).toLowerCase();
  const fmt = EXT_TO_FORMAT[ext];
  if (!fmt) {
    throw new FileParserError(
      ErrorCode.UNSUPPORTED_FORMAT,
      `Unsupported file extension: ${ext || '(none)'}`,
      { filePath },
    );
  }
  return fmt;
}
