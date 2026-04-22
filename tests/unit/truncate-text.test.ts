import { describe, expect, it } from 'vitest';
import { truncateText } from '../../src/extractors/utils/truncate-text.js';

describe('truncateText', () => {
  it('does not truncate short text', () => {
    const out = truncateText('hello world');
    expect(out.truncated).toBe(false);
    expect(out.text).toBe('hello world');
    expect(out.originalLength).toBe(11);
  });

  it('truncates text longer than maxChars with default 3500/1500 window', () => {
    const text = 'a'.repeat(6000);
    const out = truncateText(text);
    expect(out.truncated).toBe(true);
    expect(out.originalLength).toBe(6000);
    expect(out.text).toContain('truncated 1000 chars');
  });

  it('respects custom head/tail/maxChars', () => {
    const text = 'x'.repeat(100);
    const out = truncateText(text, 50, 20, 10);
    expect(out.truncated).toBe(true);
    expect(out.headCount).toBe(20);
    expect(out.tailCount).toBe(10);
  });
});
