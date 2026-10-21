/** Tags are case-sensitive project metadata, matching the Core storage contract. */
export interface TaggedItem {
  readonly tags?: readonly string[];
}
export function tagCounts(
  items: readonly TaggedItem[],
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items)
    for (const tag of new Set(item.tags ?? [])) {
      if (typeof tag === 'string' && tag)
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
export function matchesTags(
  item: TaggedItem,
  selected: readonly string[],
): boolean {
  return selected.every((tag) => item.tags?.includes(tag));
}
export function newTagError(value: string, tags: readonly string[]): string {
  const tag = value.trim();
  if (!tag) return 'Enter a tag.';
  if (new TextEncoder().encode(tag).length > 50)
    return 'Use at most 50 bytes for a tag.';
  return tags.includes(tag) ? 'This tag is already added.' : '';
}
