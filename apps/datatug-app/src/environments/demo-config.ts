/**
 * The `demoRoute` flag and the demo's data source, per environment. Passed to the lazy-loaded demo page as
 * route data and validated there (libs/datatug/main/src/lib/demo/demo-config.ts).
 */
export interface DatatugDemoConfig {
  /** The `demoRoute` flag: when false the `/demo` route is not registered at all. */
  readonly enabled: boolean;
  /** Where the saved query's three sources are read from. */
  readonly dataSource: { readonly kind: 'ovdb'; readonly baseUrl: string } | { readonly kind: 'static' };
  /** Development and e2e only: let localStorage choose the data source (static files, or another OVDB server). */
  readonly allowDataSourceOverride: boolean;
}
