/** Address checked for record-key leakage; Angular's dev component transport adds an unrelated cache timestamp. */
export function recordKeyRequestUrl(
  url: string,
  appOrigin: string,
  method: string,
): string {
  if (method !== 'GET') return url;
  try {
    const parsed = new URL(url);
    const timestamps = parsed.searchParams.getAll('t');
    if (
      parsed.origin !== new URL(appOrigin).origin ||
      parsed.pathname !== '/@ng/component' ||
      !parsed.searchParams.get('c') ||
      timestamps.length !== 1 ||
      !/^\d{13}$/.test(timestamps[0])
    )
      return url;
    // A duplicate t is left intact above; every other parameter (including duplicates) stays checked.
    parsed.searchParams.delete('t');
    return parsed.href;
  } catch {
    return url;
  }
}
