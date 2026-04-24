import { describe, expect, it } from 'vitest';
import { parsePromptFile, buildUserPrompt } from '../../src/llm/prompt.js';

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

  it('parses `thinking: true` into frontmatter.thinking', () => {
    const out = parsePromptFile(`---
name: with-thinking
thinking: true
---
body`);
    expect(out.frontmatter.thinking).toBe(true);
  });

  it('parses `thinking: false` into frontmatter.thinking', () => {
    const out = parsePromptFile(`---
thinking: false
---
body`);
    expect(out.frontmatter.thinking).toBe(false);
  });

  it('leaves frontmatter.thinking undefined when absent', () => {
    const out = parsePromptFile(`---
name: x
---
body`);
    expect(out.frontmatter.thinking).toBeUndefined();
  });
});

describe('buildUserPrompt', () => {
  it('anchors the document body with 【文档原文】', () => {
    const out = buildUserPrompt('body', 'raw dump');
    expect(out).toContain('body');
    expect(out).toContain('【文档原文】');
    expect(out).toContain('raw dump');
    // Anchor appears once, between body and text.
    const anchorIdx = out.indexOf('【文档原文】');
    expect(anchorIdx).toBeGreaterThan(out.indexOf('body'));
    expect(anchorIdx).toBeLessThan(out.indexOf('raw dump'));
  });

  it('preserves the text content verbatim, including markdown', () => {
    const text = '# File: a.md\n\nhello world\n\n---\n\n# File: b.md\n\nsecond';
    const out = buildUserPrompt('prompt-body', text);
    expect(out).toContain(text);
  });
});
