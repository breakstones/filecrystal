import { describe, expect, it } from 'vitest';
import { parsePromptFile, buildUserPrompt } from '../../src/llm/prompt.js';
import type { ParsedRaw } from '../../src/types.js';

describe('parsePromptFile', () => {
  it('parses frontmatter and body', () => {
    const raw = `---
name: test
model: qwen-plus
temperature: 0.2
---

# Hello
body`;
    const out = parsePromptFile(raw);
    expect(out.frontmatter.name).toBe('test');
    expect(out.frontmatter.model).toBe('qwen-plus');
    expect(out.frontmatter.temperature).toBe(0.2);
    expect(out.body).toContain('# Hello');
  });

  it('handles bodies without frontmatter', () => {
    const out = parsePromptFile('just a body');
    expect(out.body).toBe('just a body');
    expect(out.frontmatter.name).toBeUndefined();
  });
});

describe('buildUserPrompt', () => {
  it('renders sheets with cell refs', () => {
    const raw: ParsedRaw = {
      sheets: [
        {
          sheetName: 'A',
          cells: [
            { ref: 'A1', value: 'hi' },
            { ref: 'B2', value: 42 },
          ],
        },
      ],
    };
    const prompt = buildUserPrompt('body', raw);
    expect(prompt).toContain('A!A1: hi');
    expect(prompt).toContain('A!B2: 42');
  });

  it('renders pages and sections', () => {
    const raw: ParsedRaw = {
      pages: [{ pageNo: 1, text: 'page-text' }],
      sections: [{ sectionId: 'p-1', text: 'sec-text' }],
    };
    const out = buildUserPrompt('body', raw);
    expect(out).toContain('Page 1');
    expect(out).toContain('page-text');
    expect(out).toContain('p-1');
    expect(out).toContain('sec-text');
  });

  it('falls back to fullText when no structure present', () => {
    const raw: ParsedRaw = { fullText: 'raw dump' };
    expect(buildUserPrompt('body', raw)).toContain('raw dump');
  });
});
