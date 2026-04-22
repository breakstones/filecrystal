import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileParser, type ParseResult } from 'filecrystal';

export interface OpenClawHookContext {
  session: { filesDir: string };
  systemContext: string[];
  files?: ParseResult[];
}

export function makeBeforePromptBuildHook() {
  const parser = createFileParser({
    mode: process.env.FILECRYSTAL_API_KEY ? 'api' : 'mock',
    openai: process.env.FILECRYSTAL_API_KEY
      ? {
          baseUrl:
            process.env.FILECRYSTAL_BASE_URL ??
            'https://dashscope.aliyuncs.com/compatible-mode/v1',
          apiKey: process.env.FILECRYSTAL_API_KEY,
          models: {
            ocr: process.env.FILECRYSTAL_OCR_MODEL ?? 'qwen-vl-ocr-latest',
            vision: process.env.FILECRYSTAL_VISION_MODEL ?? 'qwen-vl-max',
            text: process.env.FILECRYSTAL_TEXT_MODEL ?? 'qwen-plus',
          },
        }
      : undefined,
  });

  return async function beforePromptBuild(ctx: OpenClawHookContext): Promise<void> {
    const files = await readdir(ctx.session.filesDir);
    const parsed = await Promise.all(
      files.map((name) => parser.parse(join(ctx.session.filesDir, name))),
    );
    ctx.systemContext.push(
      `[filecrystal] parsed ${parsed.length} file(s):\n` +
        parsed.map((p) => `- ${p.source.fileName} (${p.source.fileFormat})`).join('\n'),
    );
    ctx.files = parsed;
  };
}
