import matter from 'gray-matter';

export interface PromptFrontmatter {
  name?: string;
  schemaVersion?: string;
  model?: string;
  temperature?: number;
  /**
   * Opt a single prompt into / out of provider thinking-mode (e.g. Qwen3
   * `enable_thinking`). Takes precedence over the env-level default
   * (`FILECRYSTAL_TEXT_MODEL_THINKING`). Omit to inherit env/config.
   */
  thinking?: boolean;
  extraction?: 'llm' | 'rule-based';
}

export interface ParsedPrompt {
  frontmatter: PromptFrontmatter;
  body: string;
}

export function parsePromptFile(raw: string): ParsedPrompt {
  const parsed = matter(raw);
  return {
    frontmatter: parsed.data as PromptFrontmatter,
    body: parsed.content.trim(),
  };
}

/**
 * Assemble the user-role prompt: the prompt body, then the `【文档原文】`
 * anchor (kept stable so existing prompts that reference it keep working),
 * then the already-joined document text.
 */
export function buildUserPrompt(promptBody: string, text: string): string {
  return `${promptBody}\n\n【文档原文】\n${text}`;
}
