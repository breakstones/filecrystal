import { describe, expect, it } from 'vitest';
import { resolveLocator } from '../../src/llm/resolve-locator.js';
import type { ParsedRaw } from '../../src/types.js';

const raw: ParsedRaw = {
  sheets: [
    {
      sheetName: '合计',
      cells: [
        { ref: 'K23', value: 500000 },
        { ref: 'A1', value: 'hello' },
      ],
    },
  ],
  pages: [{ pageNo: 3, text: 'page 3 body' }],
  sections: [{ sectionId: 'p-42', text: 'section 42' }],
};

describe('resolveLocator', () => {
  it('parses sheet cell hint when cell exists', () => {
    const out = resolveLocator('合计!K23', raw);
    expect(out.locator).toEqual({ kind: 'sheet-cell', sheet: '合计', ref: 'K23' });
    expect(out.confidencePenalty).toBe(1);
  });

  it('penalises sheet cell hint when cell missing', () => {
    const out = resolveLocator('合计!ZZ99', raw);
    expect(out.locator).toEqual({ kind: 'sheet-cell', sheet: '合计', ref: 'ZZ99' });
    expect(out.confidencePenalty).toBe(0.5);
  });

  it('parses pdf line hint', () => {
    const out = resolveLocator('第 3 页第 5 行', raw);
    expect(out.locator).toEqual({ kind: 'pdf-line', pageNo: 3, lineNo: 5 });
    expect(out.confidencePenalty).toBe(1);
  });

  it('parses doc anchor', () => {
    const out = resolveLocator('段落 p-42', raw);
    expect(out.locator).toEqual({ kind: 'doc-anchor', sectionId: 'p-42' });
    expect(out.confidencePenalty).toBe(1);
  });

  it('returns no locator for unmatched hint', () => {
    const out = resolveLocator('somewhere else', raw);
    expect(out.locator).toBeUndefined();
    expect(out.confidencePenalty).toBe(0.5);
  });

  it('handles undefined hint gracefully', () => {
    const out = resolveLocator(undefined, raw);
    expect(out.locator).toBeUndefined();
    expect(out.confidencePenalty).toBe(1);
  });
});
