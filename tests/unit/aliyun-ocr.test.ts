import { describe, expect, it, vi } from 'vitest';

const recognizeAdvancedWithOptions = vi.fn();

vi.mock('@alicloud/ocr-api20210707', () => {
  class Client {
    recognizeAdvancedWithOptions = recognizeAdvancedWithOptions;
  }
  return {
    default: Client,
    RecognizeAdvancedRequest: class RecognizeAdvancedRequest {
      constructor(public args: Record<string, unknown>) {}
    },
    RuntimeOptions: class RuntimeOptions {
      constructor(public args: Record<string, unknown>) {}
    },
  };
});

import { createAliyunOcrBackend } from '../../src/ocr/providers/aliyun.js';
import { FileParserError } from '../../src/utils/errors.js';

describe('createAliyunOcrBackend', () => {
  it('normalizes RecognizeAdvanced Data into OcrResult blocks', async () => {
    recognizeAdvancedWithOptions.mockResolvedValueOnce({
      body: {
        Data: JSON.stringify({
          prism_wordsInfo: [
            {
              word: '第一行',
              pos: [
                { x: 10, y: 20 },
                { x: 70, y: 20 },
                { x: 70, y: 40 },
                { x: 10, y: 40 },
              ],
              probability: 99,
            },
            {
              word: '第二行',
              position: { x: 5, y: 50, width: 80, height: 18 },
              confidence: 0.8,
            },
          ],
        }),
      },
    });

    const backend = createAliyunOcrBackend({
      accessKeyId: 'ak-id',
      accessKeySecret: 'ak-secret',
      retries: 0,
    });
    const result = await backend.recognize({ imageBuffer: Buffer.from('image') });

    expect(result.provider).toBe('aliyun-ocr');
    expect(result.model).toBe('RecognizeAdvanced');
    expect(result.text).toBe('第一行\n第二行');
    expect(result.blocks).toEqual([
      { blockId: 'aliyun-1', text: '第一行', bbox: [10, 20, 60, 20], confidence: 0.99 },
      { blockId: 'aliyun-2', text: '第二行', bbox: [5, 50, 80, 18], confidence: 0.8 },
    ]);
    expect(result.avgConfidence).toBe(0.895);
  });

  it('stitches positioned OCR blocks into Markdown paragraphs', async () => {
    recognizeAdvancedWithOptions.mockResolvedValueOnce({
      body: {
        Data: JSON.stringify({
          prism_wordsInfo: [
            { word: '工程竣工验收申请表', pos: [{ x: 100, y: 10 }, { x: 300, y: 10 }, { x: 300, y: 30 }, { x: 100, y: 30 }], prob: 99 },
            { word: '项目名称：', pos: [{ x: 10, y: 60 }, { x: 80, y: 60 }, { x: 80, y: 80 }, { x: 10, y: 80 }], prob: 98 },
            { word: '鱼珠项目', pos: [{ x: 90, y: 60 }, { x: 170, y: 60 }, { x: 170, y: 80 }, { x: 90, y: 80 }], prob: 98 },
            { word: '一、验收范围', pos: [{ x: 10, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 140 }, { x: 10, y: 140 }], prob: 97 },
            { word: '室内装修工程。', pos: [{ x: 10, y: 150 }, { x: 160, y: 150 }, { x: 160, y: 170 }, { x: 10, y: 170 }], prob: 97 },
          ],
        }),
      },
    });

    const backend = createAliyunOcrBackend({ accessKeyId: 'ak-id', accessKeySecret: 'ak-secret' });
    const result = await backend.recognize({ imageBuffer: Buffer.from('image') });

    expect(result.text).toContain('## 工程竣工验收申请表');
    expect(result.text).toContain('项目名称：鱼珠项目');
    expect(result.text).toContain('一、验收范围');
    expect(result.text).toContain('室内装修工程。');
  });

  it('uses content when provided by RecognizeAdvanced and no positioned blocks exist', async () => {
    recognizeAdvancedWithOptions.mockResolvedValueOnce({
      body: { Data: JSON.stringify({ content: '完整文本', prism_wordsInfo: [] }) },
    });
    const backend = createAliyunOcrBackend({ accessKeyId: 'ak-id', accessKeySecret: 'ak-secret' });
    const result = await backend.recognize({ imageBuffer: Buffer.from('image') });
    expect(result.text).toBe('完整文本');
  });

  it('passes table, row, paragraph, and rotate options to RecognizeAdvanced', async () => {
    recognizeAdvancedWithOptions.mockResolvedValueOnce({ body: { Data: JSON.stringify({ prism_wordsInfo: [] }) } });
    const backend = createAliyunOcrBackend({
      accessKeyId: 'ak-id',
      accessKeySecret: 'ak-secret',
      outputTable: true,
      row: true,
      paragraph: true,
    });
    await backend.recognize({ imageBuffer: Buffer.from('image') });
    const [request] = recognizeAdvancedWithOptions.mock.calls.at(-1) ?? [];
    expect(request.args.outputTable).toBe(true);
    expect(request.args.row).toBe(true);
    expect(request.args.paragraph).toBe(true);
    expect(request.args.needRotate).toBe(true);
  });

  it('renders Aliyun table structure as Markdown table', async () => {
    recognizeAdvancedWithOptions.mockResolvedValueOnce({
      body: {
        Data: JSON.stringify({
          subImages: [
            {
              tableInfo: {
                tableDetails: [
                  {
                    rowCount: 2,
                    columnCount: 2,
                    cellDetails: [
                      { rowStart: 0, rowEnd: 0, columnStart: 0, columnEnd: 0, cellContent: '项目' },
                      { rowStart: 0, rowEnd: 0, columnStart: 1, columnEnd: 1, cellContent: '金额' },
                      { rowStart: 1, rowEnd: 1, columnStart: 0, columnEnd: 0, cellContent: '装修' },
                      { rowStart: 1, rowEnd: 1, columnStart: 1, columnEnd: 1, cellContent: '100|200' },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      },
    });
    const backend = createAliyunOcrBackend({ accessKeyId: 'ak-id', accessKeySecret: 'ak-secret' });
    const result = await backend.recognize({ imageBuffer: Buffer.from('image') });
    expect(result.text).toContain('| 项目 | 金额 |');
    expect(result.text).toContain('| --- | --- |');
    expect(result.text).toContain('| 装修 | 100\\|200 |');
  });

  it('renders top-level Aliyun cellInfos table structure as Markdown table', async () => {
    recognizeAdvancedWithOptions.mockResolvedValueOnce({
      body: {
        Data: JSON.stringify({
          prism_tablesInfo: [
            {
              xCellSize: 2,
              yCellSize: 2,
              cellInfos: [
                { ysc: 0, yec: 0, xsc: 0, xec: 0, word: '序号' },
                { ysc: 0, yec: 0, xsc: 1, xec: 1, word: '金额' },
                { ysc: 1, yec: 1, xsc: 0, xec: 0, word: '1' },
                { ysc: 1, yec: 1, xsc: 1, xec: 1, word: '100' },
              ],
            },
          ],
        }),
      },
    });
    const backend = createAliyunOcrBackend({ accessKeyId: 'ak-id', accessKeySecret: 'ak-secret' });
    const result = await backend.recognize({ imageBuffer: Buffer.from('image') });
    expect(result.text).toContain('| 序号 | 金额 |');
    expect(result.text).toContain('| 1 | 100 |');
  });

  it('uses paragraph structure before row fallback', async () => {
    recognizeAdvancedWithOptions.mockResolvedValueOnce({
      body: {
        Data: JSON.stringify({
          subImages: [
            {
              paragraphInfo: {
                paragraphDetails: [
                  { paragraphContent: '第一段' },
                  { paragraphContent: '第二段' },
                ],
              },
              rowInfo: {
                rowDetails: [
                  { rowContent: '第一行' },
                  { rowContent: '第二行' },
                ],
              },
            },
          ],
        }),
      },
    });
    const backend = createAliyunOcrBackend({ accessKeyId: 'ak-id', accessKeySecret: 'ak-secret' });
    const result = await backend.recognize({ imageBuffer: Buffer.from('image') });
    expect(result.text).toBe('第一段\n\n第二段');
  });

  it('wraps provider failures without leaking credentials', async () => {
    recognizeAdvancedWithOptions.mockRejectedValueOnce(new Error('provider failed'));
    const backend = createAliyunOcrBackend({
      accessKeyId: 'ak-id',
      accessKeySecret: 'super-secret-value',
      retries: 0,
    });
    try {
      await backend.recognize({ imageBuffer: Buffer.from('image') });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(FileParserError);
      expect(String((err as Error).message)).not.toContain('super-secret-value');
    }
  });
});
