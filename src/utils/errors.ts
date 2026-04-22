export const ErrorCode = {
  UNSUPPORTED_FORMAT: 'ERR_UNSUPPORTED_FORMAT',
  FILE_NOT_FOUND: 'ERR_FILE_NOT_FOUND',
  PROTECTED_FILE: 'ERR_PROTECTED_FILE',
  OCR_TIMEOUT: 'ERR_OCR_TIMEOUT',
  OCR_FAILED: 'ERR_OCR_FAILED',
  LLM_JSON_PARSE: 'ERR_LLM_JSON_PARSE',
  LLM_TIMEOUT: 'ERR_LLM_TIMEOUT',
  CONFIG_INVALID: 'ERR_CONFIG_INVALID',
  CACHE_IO: 'ERR_CACHE_IO',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class FileParserError extends Error {
  public readonly code: ErrorCodeValue;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCodeValue, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FileParserError';
    this.code = code;
    this.details = details;
  }
}
