# openclaw-hook example

Use filecrystal inside an OpenClaw `before_prompt_build` hook so that every
file in the session directory contributes structured context to the LLM.

```ts
// hook.ts
import { createFileParser } from 'filecrystal';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const parser = createFileParser({
  mode: 'api',
  openai: {
    baseUrl: process.env.FILECRYSTAL_BASE_URL!,
    apiKey: process.env.FILECRYSTAL_API_KEY!,
    models: { ocr: 'qwen-vl-ocr-latest', vision: 'qwen-vl-max', text: 'qwen-plus' },
  },
});

export async function beforePromptBuild(ctx) {
  const dir = ctx.session.filesDir;
  const files = await readdir(dir);
  const parsed = await Promise.all(
    files.map((name) => parser.parse(join(dir, name))),
  );
  ctx.systemContext.push(
    `[filecrystal] parsed ${parsed.length} file(s):\n` +
      parsed.map((p) => `- ${p.source.fileName} (${p.source.fileFormat})`).join('\n'),
  );
  ctx.files = parsed;
}
```

Swap the preset to any OpenAI-compatible provider by changing `baseUrl` and
model names — the rest of the code stays the same.
