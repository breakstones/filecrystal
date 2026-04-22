import OpenAI from 'openai';
import type { OcrBackend, OcrRequest, OcrResult } from './backend.js';
import { retry } from '../utils/concurrency.js';
import { FileParserError, ErrorCode } from '../utils/errors.js';

export interface OpenAICompatOcrOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  retries?: number;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT =
  '你是 OCR 与版面分析助手。请识别图片中的全部可读文字,按阅读顺序输出。' +
  '如需,也输出每段文字的估计位置 bbox(归一化到 0-1)。';

const SEAL_PROMPT_EXTENSION =
  '\n\n同时识别图中的【印章】和【手写/电子签名】。' +
  '在返回的 JSON 中,除了 text 与 blocks,再给出 seals 与 signatures 数组,' +
  '字段见 SealDetection / SignatureDetection 类型定义。';

interface OcrJson {
  text?: string;
  blocks?: Array<{
    blockId?: string;
    text?: string;
    bbox?: [number, number, number, number];
    confidence?: number;
  }>;
  seals?: unknown[];
  signatures?: unknown[];
}

export function createOpenAICompatOcrBackend(opts: OpenAICompatOcrOptions): OcrBackend {
  const client = new OpenAI({
    baseURL: opts.baseUrl,
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 60_000,
  });
  const retries = opts.retries ?? 2;

  return {
    async recognize(req: OcrRequest): Promise<OcrResult> {
      const start = Date.now();
      const systemPrompt =
        (opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT) +
        (req.detectSealsAndSignatures ? SEAL_PROMPT_EXTENSION : '');
      const mimeType = req.mimeType ?? 'image/png';
      const dataUrl = `data:${mimeType};base64,${req.imageBuffer.toString('base64')}`;

      const completion = await retry(
        () =>
          client.chat.completions.create(
            {
              model: opts.model,
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: '请识别该图片内容,以 JSON 输出。' },
                    { type: 'image_url', image_url: { url: dataUrl } },
                  ],
                },
              ],
              response_format: { type: 'json_object' },
              temperature: 0,
            },
            req.signal ? { signal: req.signal } : undefined,
          ),
        { retries },
      );

      const choice = completion.choices[0];
      const content = choice?.message?.content;
      if (!content) {
        throw new FileParserError(ErrorCode.OCR_FAILED, 'OCR response has no content', {
          model: opts.model,
        });
      }

      let parsed: OcrJson;
      try {
        parsed = JSON.parse(content) as OcrJson;
      } catch (err) {
        throw new FileParserError(ErrorCode.LLM_JSON_PARSE, 'OCR JSON parse failed', {
          cause: String(err),
          snippet: content.slice(0, 200),
        });
      }

      const blocks = (parsed.blocks ?? []).map((b, idx) => ({
        blockId: b.blockId ?? `b-${idx + 1}`,
        text: b.text ?? '',
        bbox: b.bbox,
        confidence: b.confidence,
      }));

      return {
        text: parsed.text ?? blocks.map((b) => b.text).join('\n'),
        blocks,
        seals: parsed.seals as OcrResult['seals'],
        signatures: parsed.signatures as OcrResult['signatures'],
        usage: {
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
        },
        model: opts.model,
        ms: Date.now() - start,
      };
    },
  };
}
