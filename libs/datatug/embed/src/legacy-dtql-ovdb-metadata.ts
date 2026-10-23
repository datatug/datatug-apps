// Removed in TugQL cutover step 9.
//
// Until the OpenVaultDB servers are redeployed (openvaultdb-go v0.26.2), production OVDB
// metadata still advertises the pre-rename names: `capabilities.dtql*`, `endpoints.dtql`
// and `queryFormat: "dtql-yaml+json"`. Every reader of that metadata goes through the
// helpers below, so deleting this file (and its call sites) is the whole of step 9.
// Requests always go to the `/tugql` route, never `/dtql`.
//
// Copy of libs/datatug/main/src/lib/ovdb/legacy-dtql-ovdb-metadata.ts: the embed package is
// standalone (Nx module boundaries forbid importing the main library). Delete both together.

const FLAGS = ['', 'Streaming', 'StreamingErrors'] as const;

/**
 * Capability flags with `tugql*` falling back to the legacy `dtql*`. A new `tugql*` value
 * always wins, whatever the legacy one says.
 */
export function withTugqlCapabilities<T extends object>(capabilities: T): T {
  const flags = capabilities as Record<string, unknown>;
  const result: Record<string, unknown> = { ...flags };
  for (const suffix of FLAGS) {
    const legacy = flags[`dtql${suffix}`];
    if (result[`tugql${suffix}`] === undefined && legacy !== undefined) result[`tugql${suffix}`] = legacy;
  }
  return result as T;
}

/** Whether a capability list (the array form) offers TugQL, under either name. */
export function capabilityListOffersTugql(capabilities: readonly unknown[]): boolean {
  return capabilities.includes('tugql') || capabilities.includes('dtql');
}

/**
 * The advertised TugQL endpoint: `endpoints.tugql`, else the legacy `endpoints.dtql`
 * with its route changed to `/tugql` (the servers answer `/tugql` either way).
 */
export function tugqlEndpoint(endpoints: { readonly tugql?: string; readonly dtql?: string } | undefined): string | undefined {
  if (endpoints?.tugql) return endpoints.tugql;
  return endpoints?.dtql?.replace(/\/dtql(?=$|[?#])/u, '/tugql');
}

/** The query format under its current name; `dtql-yaml*` is read as `tugql-yaml*`. */
export function tugqlQueryFormat(queryFormat: string | undefined): string | undefined {
  return queryFormat?.replace(/^dtql-/u, 'tugql-');
}
