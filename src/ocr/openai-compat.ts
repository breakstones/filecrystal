import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import type { OcrBackend, OcrRequest, OcrResult } from './backend.js';
import { retry } from '../utils/concurrency.js';
import { FileParserError, ErrorCode } from '../utils/errors.js';
import type { SealDetection, SignatureDetection } from '../types.js';

export interface OpenAICompatOcrOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  retries?: number;
  systemPrompt?: string;
  /**
   * If the first call hasn't resolved within `speculativeAfterMs`, fire a
   * second, identical call and return whichever resolves first ("hedged
   * request"). Cuts the tail latency on providers with occasional slow
   * instances; doubles cost only when the tail actually kicks in.
   * Set to 0 or undefined to disable. Default: 8_000 (8 s).
   */
  speculativeAfterMs?: number;
  /**
   * Extra body fields passed verbatim to `chat.completions.create`. Used to
   * toggle provider-specific switches, e.g. DashScope's `enable_thinking`
   * for Qwen3 reasoning models.
   */
  extraBody?: Record<string, unknown>;
}

/**
 * Markdown-first OCR prompt. The model writes the page directly as Markdown
 * (headings, tables, lists), with inline markers for seals/signatures when
 * requested. No JSON envelope, no bbox — keeps output minimal and lets the
 * downstream LLM consume the text without further cleaning.
 */
const DEFAULT_SYSTEM_PROMPT = [
  '你是 OCR 与版面还原助手。把图片中的全部可读文字按阅读顺序提取出来,',
  '以 **Markdown 格式** 直接输出。',
  '',
  '格式要求:',
  '- 标题用 `#` / `##` / `###`;',
  '- 表格用 Markdown 管道表格(`| 列 | 列 |`),表头下紧跟分隔行;',
  '- 列表用 `-` 或有序编号;',
  '- 段落之间空一行;',
  '- 不要包裹进 ```` ```markdown ```` 或 JSON;',
  '- 不要输出 bbox、坐标、解释性文字,只输出 Markdown 正文。',
].join('\n');

const SEAL_PROMPT_EXTENSION = [
  '',
  '额外要求:',
  '- 识别到【印章】(公章/合同章/发票章等)时,在 Markdown 对应位置插入 `【印章:<单位全称> | <颜色:红/蓝/黑> | <形状:圆形/椭圆/方形>】`。',
  '- 识别到【签名】(手写/电子/签章)时,插入 `【签名:<姓名或可读文字>】`。',
  '- 若字段不清晰,对应字段填 `未知`;整个位置没有印章/签名就不要插入任何标记。',
].join('\n');

const USER_INSTRUCTION = '请识别该图的全部文字,按上述要求输出 Markdown。';

export function createOpenAICompatOcrBackend(opts: OpenAICompatOcrOptions): OcrBackend {
  const client = new OpenAI({
    baseURL: opts.baseUrl,
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 60_000,
  });
  const retries = opts.retries ?? 2;
  const speculativeAfterMs = opts.speculativeAfterMs ?? 8_000;
  const extraBody = opts.extraBody;

  return {
    async recognize(req: OcrRequest): Promise<OcrResult> {
      const start = Date.now();
      const systemPrompt =
        (opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT) +
        (req.detectSealsAndSignatures ? SEAL_PROMPT_EXTENSION : '');
      const mimeType = req.mimeType ?? 'image/png';
      const dataUrl = `data:${mimeType};base64,${req.imageBuffer.toString('base64')}`;

      const fireOnce = (abortSignal?: AbortSignal): Promise<ChatCompletion> => {
        const body = {
          model: opts.model,
          messages: [
            { role: 'system' as const, content: systemPrompt },
            {
              role: 'user' as const,
              content: [
                { type: 'text' as const, text: USER_INSTRUCTION },
                { type: 'image_url' as const, image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0,
          stream: false as const,
          ...(extraBody ?? {}),
        };
        // `extraBody` carries provider-specific fields (e.g. Qwen3
        // `enable_thinking`). The SDK forwards unknown fields verbatim but
        // TS doesn't know the exact shape, so we cast once.
        return client.chat.completions.create(
          body as unknown as Parameters<typeof client.chat.completions.create>[0],
          abortSignal ? { signal: abortSignal } : req.signal ? { signal: req.signal } : undefined,
        ) as Promise<ChatCompletion>;
      };

      const completion = await retry(
        () =>
          speculativeAfterMs > 0
            ? hedgedFetch(fireOnce, speculativeAfterMs, req.signal)
            : fireOnce(),
        { retries },
      );

      const choice = completion.choices[0];
      const content = choice?.message?.content;
      if (!content) {
        throw new FileParserError(ErrorCode.OCR_FAILED, 'OCR response has no content', {
          model: opts.model,
        });
      }

      const markdown = cleanMarkdownEnvelope(content);
      const seals = req.detectSealsAndSignatures ? extractSealMarks(markdown) : undefined;
      const signatures = req.detectSealsAndSignatures
        ? extractSignatureMarks(markdown)
        : undefined;

      return {
        text: markdown,
        blocks: [], // intentionally empty — Markdown is the only structured representation
        ...(seals && seals.length > 0 ? { seals } : {}),
        ...(signatures && signatures.length > 0 ? { signatures } : {}),
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

/**
 * Strip common wrappers that a chat model may emit around the Markdown body:
 *  - Fenced code blocks ```markdown ... ``` or ``` ... ```
 *  - Legacy JSON envelopes {"text": "..."} from older qwen-vl-ocr variants
 */
function cleanMarkdownEnvelope(raw: string): string {
  let s = raw.trim();
  // Strip any ``` fence regardless of language tag
  const fenceMatch = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(s);
  if (fenceMatch) s = fenceMatch[1]!.trim();
  // Legacy envelope: some models return {"text":"..."} even without json_object
  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      const parsed = JSON.parse(s) as { text?: unknown };
      if (typeof parsed.text === 'string') return parsed.text.trim();
    } catch {
      // not JSON — keep as-is
    }
  }
  return s;
}

const SEAL_MARK_RE = /【印章[::]([^】]+)】/g;
const SIG_MARK_RE = /【签名[::]([^】]+)】/g;

function extractSealMarks(md: string): SealDetection[] {
  const out: SealDetection[] = [];
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = SEAL_MARK_RE.exec(md)) !== null) {
    idx++;
    const parts = m[1]!.split(/[||]/).map((p) => p.trim()).filter(Boolean);
    const ownerText = parts[0] && parts[0] !== '未知' ? parts[0] : undefined;
    const colorTxt = parts[1] ?? parts.find((p) => /[红蓝黑紫]/.test(p));
    const shapeTxt = parts[2] ?? parts.find((p) => /(圆|椭|方|矩)/.test(p));
    const seal: SealDetection = {
      sealId: `seal-${idx}`,
      type: 'unknown',
      confidence: 0.7,
      locator: { kind: 'image-bbox', pageNo: 1 },
    };
    if (ownerText) seal.ownerText = ownerText;
    const c = mapColor(colorTxt);
    if (c) seal.color = c;
    const sh = mapShape(shapeTxt);
    if (sh) seal.shape = sh;
    out.push(seal);
  }
  return out;
}

function extractSignatureMarks(md: string): SignatureDetection[] {
  const out: SignatureDetection[] = [];
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = SIG_MARK_RE.exec(md)) !== null) {
    idx++;
    const signerText = m[1]!.trim();
    const sig: SignatureDetection = {
      signatureId: `sig-${idx}`,
      type: 'handwritten',
      confidence: 0.7,
      locator: { kind: 'image-bbox', pageNo: 1 },
    };
    if (signerText && signerText !== '未知') sig.signerText = signerText;
    out.push(sig);
  }
  return out;
}

function mapColor(s?: string): SealDetection['color'] | undefined {
  if (!s) return undefined;
  if (s.includes('红')) return 'red';
  if (s.includes('蓝')) return 'blue';
  if (s.includes('黑')) return 'black';
  return undefined;
}

function mapShape(s?: string): SealDetection['shape'] | undefined {
  if (!s) return undefined;
  if (s.includes('椭')) return 'oval';
  if (s.includes('圆')) return 'circle';
  if (s.includes('方') || s.includes('矩')) return 'rectangle';
  return undefined;
}

/**
 * Hedged-request pattern. Fire the first call; if it hasn't resolved by
 * `hedgeAfterMs`, fire a second identical call in parallel. Resolve with
 * whichever FULFILS first. Only reject if BOTH fail (so a single timeout
 * on request #1 doesn't poison the race — request #2 often succeeds).
 * The loser is aborted to stop wasted billing.
 */
async function hedgedFetch<T>(
  fire: (signal?: AbortSignal) => Promise<T>,
  hedgeAfterMs: number,
  upstreamSignal?: AbortSignal,
): Promise<T> {
  const c1 = new AbortController();
  const c2 = new AbortController();
  let done = false;
  const cleanup = () => {
    done = true;
    c1.abort();
    c2.abort();
  };
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      cleanup();
      throw new DOMException('Aborted', 'AbortError');
    }
    upstreamSignal.addEventListener('abort', cleanup, { once: true });
  }

  type Settled<R> = { ok: true; v: R } | { ok: false; e: unknown };
  const wrap = <R>(p: Promise<R>): Promise<Settled<R>> =>
    p.then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    );

  const first = fire(c1.signal);
  const firstSettled = wrap(first);
  const hedgeTimer = new Promise<'hedge'>((resolve) =>
    setTimeout(() => resolve('hedge'), hedgeAfterMs),
  );

  const firstOrTimer = await Promise.race([
    firstSettled.then((s) => ({ kind: 'first' as const, s })),
    hedgeTimer.then(() => ({ kind: 'hedge' as const })),
  ]);

  if (firstOrTimer.kind === 'first') {
    cleanup();
    if (firstOrTimer.s.ok) return firstOrTimer.s.v;
    throw firstOrTimer.s.e;
  }

  const second = fire(c2.signal);
  try {
    const value = await Promise.any([first, second]);
    if (!done) {
      c1.abort();
      c2.abort();
    }
    void first.catch(() => undefined);
    void second.catch(() => undefined);
    return value;
  } catch (err) {
    const agg = err as AggregateError & { errors?: unknown[] };
    const errs = agg?.errors;
    if (Array.isArray(errs) && errs.length > 0) throw errs[errs.length - 1];
    throw err;
  }
}
