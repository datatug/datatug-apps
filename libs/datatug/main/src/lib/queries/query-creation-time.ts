/** Persisted creation metadata uses the same nonzero RFC3339 UTC format as Core. */
export function isQueryCreationTime(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  )
    return false;
  const time = Date.parse(value);
  return (
    Number.isFinite(time) &&
    time !== Date.parse('0001-01-01T00:00:00Z') &&
    new Date(time).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
