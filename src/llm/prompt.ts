import matter from 'gray-matter';
import type { ParsedRaw } from '../types.js';

export interface PromptFrontmatter {
  name?: string;
  schemaVersion?: string;
  model?: string;
  temperature?: number;
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

export function buildUserPrompt(promptBody: string, raw: ParsedRaw): string {
  const parts: string[] = [promptBody, '', '【文档原文】'];
  if (raw.sheets && raw.sheets.length > 0) {
    for (const s of raw.sheets) {
      parts.push(`## Sheet: ${s.sheetName}`);
      for (const c of s.cells) {
        parts.push(`${s.sheetName}!${c.ref}: ${c.value ?? ''}`);
      }
    }
  }
  if (raw.pages && raw.pages.length > 0) {
    for (const p of raw.pages) {
      parts.push(`## Page ${p.pageNo}`);
      parts.push(p.text);
    }
  }
  if (raw.sections && raw.sections.length > 0) {
    for (const sec of raw.sections) {
      parts.push(`## ${sec.sectionId}${sec.title ? ` — ${sec.title}` : ''}`);
      parts.push(sec.text);
    }
  }
  if (!raw.sheets?.length && !raw.pages?.length && !raw.sections?.length && raw.fullText) {
    parts.push(raw.fullText);
  }
  return parts.join('\n');
}
