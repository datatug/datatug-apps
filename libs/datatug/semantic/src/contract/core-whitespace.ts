/** Exact Unicode White_Space set used by Go strings.TrimSpace (Core v0.63).
 * ECMAScript trim excludes NEL (U+0085) and adds BOM (U+FEFF), so it is not
 * interchangeable for Core's nonempty/canonical identity checks.
 */
export function trimCoreSpace(value: string): string {
  return value.replace(
    /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,
    '',
  );
}
