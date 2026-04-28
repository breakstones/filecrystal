import type { ResolvedConfig, ResolvedOcrProviderConfig } from '../config.js';
import type { OcrBackend } from './backend.js';
import { createOpenAICompatOcrBackend } from './openai-compat.js';
import { createAliyunOcrBackend } from './providers/aliyun.js';
import { ErrorCode, FileParserError } from '../utils/errors.js';

export function createOcrBackend(
  provider: ResolvedOcrProviderConfig,
  ocrConfig: ResolvedConfig['ocr'],
): OcrBackend {
  switch (provider.provider) {
    case 'openai-compat': {
      if (!provider.openai) {
        throw new FileParserError(ErrorCode.CONFIG_INVALID, 'openai-compat OCR provider is missing endpoint config');
      }
      const extraBody = { enable_thinking: ocrConfig.enableThinking };
      return createOpenAICompatOcrBackend({
        baseUrl: provider.openai.baseUrl,
        apiKey: provider.openai.apiKey,
        model: provider.openai.model,
        timeoutMs: ocrConfig.timeoutMs,
        retries: ocrConfig.retries,
        extraBody,
      });
    }
    case 'aliyun-ocr': {
      if (!provider.aliyun) {
        throw new FileParserError(ErrorCode.CONFIG_INVALID, 'aliyun-ocr provider is missing endpoint config');
      }
      return createAliyunOcrBackend({
        accessKeyId: provider.aliyun.accessKeyId,
        accessKeySecret: provider.aliyun.accessKeySecret,
        endpoint: provider.aliyun.endpoint,
        regionId: provider.aliyun.regionId,
        timeoutMs: ocrConfig.timeoutMs,
        retries: ocrConfig.retries,
        outputTable: provider.aliyun.outputTable,
        row: provider.aliyun.row,
        paragraph: provider.aliyun.paragraph,
      });
    }
    default:
      throw new FileParserError(
        ErrorCode.CONFIG_INVALID,
        `Unsupported OCR provider: ${(provider as { provider?: string }).provider}`,
      );
  }
}
