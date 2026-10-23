/** Case-insensitive, width-insensitive comparison form of a text (search matching and highlighting). */
export const fold = (text: string) =>
  text.normalize('NFKC').toLocaleLowerCase('en-US');

export interface HighlightPart {
  readonly text: string;
  readonly hit: boolean;
}

/** Splits `text` around every case-insensitive occurrence of `query`, for `<mark>` rendering. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const q = fold(query.trim());
  if (!q || !text) return [{ text, hit: false }];
  const folded = fold(text);
  // NFKC folding can change lengths; highlight only when positions map one to one.
  if (folded.length !== text.length) return [{ text, hit: false }];
  const parts: HighlightPart[] = [];
  let from = 0;
  for (let at = folded.indexOf(q); at >= 0; at = folded.indexOf(q, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + q.length), hit: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts;
}
