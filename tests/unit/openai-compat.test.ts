import { describe, expect, it, vi, beforeEach } from 'vitest';

const create = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create } },
  })),
}));

import { createOpenAICompatOcrBackend } from '../../src/ocr/openai-compat.js';
import { createOpenAICompatLlmBackend } from '../../src/llm/openai-compat.js';
import { FileParserError } from '../../src/utils/errors.js';

beforeEach(() => {
  create.mockReset();
});

describe('createOpenAICompatOcrBackend (Markdown mode)', () => {
  it('sends the image data URL and returns the Markdown body verbatim', async () => {
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '# Test Contract\n\nParty A: Acme Corp\nParty B: Contoso Ltd',
          },
        },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 7 },
    });

    const ocr = createOpenAICompatOcrBackend({
      baseUrl: 'https://test.example/v1',
      apiKey: 'sk-test',
      model: 'test-vl-ocr',
      retries: 0,
      speculativeAfterMs: 0,
    });
    const result = await ocr.recognize({
      imageBuffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
    });

    expect(result.text).toContain('# Test Contract');
    expect(result.text).toContain('Party A: Acme Corp');
    expect(result.blocks).toEqual([]); // no bbox/blocks in Markdown mode
    expect(result.usage?.promptTokens).toBe(30);
    expect(result.model).toBe('test-vl-ocr');

    const [call] = create.mock.calls;
    expect(call![0].model).toBe('test-vl-ocr');
    const userContent = call![0].messages[1].content;
    expect(userContent[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    // Markdown mode: no response_format json_object constraint
    expect(call![0].response_format).toBeUndefined();
  });

  it('extracts inline 【印章:...】 and 【签名:...】 markers when seals enabled', async () => {
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              '# Payment Note\n\nAmount: 100000\n\n【印章:Acme Corp | 红色 | 圆形】\n\n【签名:John Doe】',
          },
        },
      ],
    });
    const ocr = createOpenAICompatOcrBackend({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      retries: 0,
      speculativeAfterMs: 0,
    });
    const res = await ocr.recognize({
      imageBuffer: Buffer.from('x'),
      mimeType: 'image/png',
      detectSealsAndSignatures: true,
    });
    expect(res.seals?.length).toBe(1);
    expect(res.seals?.[0]?.ownerText).toBe('Acme Corp');
    expect(res.seals?.[0]?.color).toBe('red');
    expect(res.seals?.[0]?.shape).toBe('circle');
    expect(res.signatures?.length).toBe(1);
    expect(res.signatures?.[0]?.signerText).toBe('John Doe');
  });

  it('throws FileParserError when OCR returns empty content', async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: null } }] });
    const ocr = createOpenAICompatOcrBackend({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      retries: 0,
      speculativeAfterMs: 0,
    });
    await expect(
      ocr.recognize({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(FileParserError);
  });

  it('strips markdown code-fence envelopes (any language tag)', async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: '```markdown\n# Title\n\nbody\n```' } }],
    });
    const ocr = createOpenAICompatOcrBackend({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      retries: 0,
      speculativeAfterMs: 0,
    });
    const res = await ocr.recognize({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' });
    expect(res.text).toBe('# Title\n\nbody');
  });

  it('peels legacy JSON envelope for backward compatibility', async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"text":"peeled markdown body","blocks":[]}' } }],
    });
    const ocr = createOpenAICompatOcrBackend({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      retries: 0,
      speculativeAfterMs: 0,
    });
    const res = await ocr.recognize({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' });
    expect(res.text).toBe('peeled markdown body');
  });

  it('forwards extraBody (e.g. enable_thinking) verbatim to create()', async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'hi' } }],
    });
    const ocr = createOpenAICompatOcrBackend({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'qwen3-vl-plus',
      retries: 0,
      speculativeAfterMs: 0,
      extraBody: { enable_thinking: true, thinking_budget: 1000 },
    });
    await ocr.recognize({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' });
    const body = create.mock.calls[0]![0];
    expect(body.enable_thinking).toBe(true);
    expect(body.thinking_budget).toBe(1000);
  });
});

describe('createOpenAICompatLlmBackend', () => {
  it('passes the model JSON through verbatim (no normalisation)', async () => {
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              contractName: {
                value: 'Alpha',
                confidence: 0.95,
                locator_hint: 'Sheet1!A1',
              },
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });

    const llm = createOpenAICompatLlmBackend({
      baseUrl: 'https://test/v1',
      apiKey: 'k',
      model: 'chat-xyz',
      retries: 0,
    });
    const result = await llm.extract({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      temperature: 0.1,
    });

    // Raw JSON is passed through: the prompt's schema wins.
    const contractName = result.fields.contractName as Record<string, unknown>;
    expect(contractName.value).toBe('Alpha');
    expect(contractName.confidence).toBe(0.95);
    expect(contractName.locator_hint).toBe('Sheet1!A1');
    expect(result.parseFailed).toBeFalsy();
    expect(result.rawContent).toBeTruthy();
    expect(result.model).toBe('chat-xyz');
    expect(result.usage?.promptTokens).toBe(100);

    const [call] = create.mock.calls;
    expect(call![0].messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
    expect(call![0].response_format).toEqual({ type: 'json_object' });
  });

  it('falls back to { text } when the content is not valid JSON', async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'Sorry, I can only reply in prose.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const llm = createOpenAICompatLlmBackend({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      retries: 0,
    });
    const result = await llm.extract({ systemPrompt: 's', userPrompt: 'u' });
    expect(result.parseFailed).toBe(true);
    expect(result.fields.text).toBe('Sorry, I can only reply in prose.');
  });

  it('repairs common JSON flaws (code fence + trailing comma)', async () => {
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '```json\n{ "contractName": "Alpha", "amount": 100, }\n```',
          },
        },
      ],
    });
    const llm = createOpenAICompatLlmBackend({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      retries: 0,
    });
    const result = await llm.extract({ systemPrompt: 's', userPrompt: 'u' });
    expect(result.fields.contractName).toBe('Alpha');
    expect(result.fields.amount).toBe(100);
    expect(result.parseFailed).toBeFalsy();
  });

  it('allows disabling json_object format', async () => {
    create.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({}) } }],
    });
    const llm = createOpenAICompatLlmBackend({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      retries: 0,
    });
    await llm.extract({ systemPrompt: 's', userPrompt: 'u', responseFormatJson: false });
    expect(create.mock.calls[0]![0].response_format).toBeUndefined();
  });
});
