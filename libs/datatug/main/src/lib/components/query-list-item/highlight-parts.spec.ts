import { describe, expect, it } from 'vitest';
import { highlightParts } from './highlight-parts';

describe('highlightParts', () => {
  it('splits around every case-insensitive hit', () => {
    expect(highlightParts('Top customers', 'CUST')).toEqual([
      { text: 'Top ', hit: false },
      { text: 'cust', hit: true },
      { text: 'omers', hit: false },
    ]);
  });
  it('marks nothing for an empty query or text', () => {
    expect(highlightParts('Orders', '  ')).toEqual([
      { text: 'Orders', hit: false },
    ]);
    expect(highlightParts('', 'x')).toEqual([{ text: '', hit: false }]);
  });
  it('marks nothing when folding changes the length', () => {
    expect(highlightParts('ﬁle', 'file')).toEqual([
      { text: 'ﬁle', hit: false },
    ]);
  });
});
