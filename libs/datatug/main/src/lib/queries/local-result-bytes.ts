/** Exact UTF-8 JSON size without first allocating an entire serialization buffer.
 * Reservation must precede IndexedDB's clone/serialization, including metadata. */
export function localResultBytes(value: unknown): number {
  const ancestors = new Set<object>();
  const stringBytes = (text: string): number => {
    let count = 2;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) count += 2;
      else if (code < 32) count += 6;
      else if (code < 128) count++;
      else if (code < 2048) count += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { count += 4; index++; } else count += 6;
      } else if (code >= 0xdc00 && code <= 0xdfff) count += 6;
      else count += 3;
    }
    return count;
  };
  const size = (item: unknown): number => {
    if (item === null) return 4;
    if (typeof item === 'string') return stringBytes(item);
    if (typeof item === 'boolean') return item ? 4 : 5;
    if (typeof item === 'number') return Number.isFinite(item) ? String(item).length : 4;
    if (typeof item !== 'object') throw new Error('Local result metadata must be JSON data.');
    if (ancestors.has(item)) throw new Error('Local result metadata is cyclic.');
    ancestors.add(item);
    let count = 2;
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) count += (index ? 1 : 0) + (item[index] === undefined ? 4 : size(item[index]));
    } else {
      let members = 0;
      for (const [key, member] of Object.entries(item)) {
        if (member === undefined) continue;
        count += (members++ ? 1 : 0) + stringBytes(key) + 1 + size(member);
      }
    }
    ancestors.delete(item);
    return count;
  };
  return size(value);
}
