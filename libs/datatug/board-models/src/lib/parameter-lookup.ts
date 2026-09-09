// Public API entry — see ../public_api.ts.

/**
 * Mirrors `ParameterLookup` in `boards.go` (defined there, not in
 * `parameters.go`) field for field.
 */
export interface ParameterLookup {
  db: string;
  sql: string;
  keyFields: string[];
}
