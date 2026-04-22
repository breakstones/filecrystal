import { describe, expect, it } from 'vitest';
import { selectPages } from '../../src/extractors/utils/select-pages.js';

describe('selectPages', () => {
  it('returns empty for non-positive totals', () => {
    expect(selectPages(0)).toEqual([]);
    expect(selectPages(-1)).toEqual([]);
  });

  it('returns all pages when total <= max', () => {
    expect(selectPages(1)).toEqual([1]);
    expect(selectPages(10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('splits head/tail with the default 7:3 ratio', () => {
    expect(selectPages(11)).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 11]);
    expect(selectPages(30)).toEqual([1, 2, 3, 4, 5, 6, 7, 28, 29, 30]);
  });

  it('honours a custom ratio', () => {
    const out = selectPages(100, [8, 2], 10);
    expect(out.slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.slice(-2)).toEqual([99, 100]);
  });

  it('handles very large totals', () => {
    const out = selectPages(1000);
    expect(out.length).toBe(10);
    expect(out[0]).toBe(1);
    expect(out[out.length - 1]).toBe(1000);
  });
});
