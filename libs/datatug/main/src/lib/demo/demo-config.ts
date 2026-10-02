// How the demo route is switched on, and where its data comes from.
//
// The app passes this as route data (apps/datatug-app/src/app/datatug-app-routes.ts), taken from the
// environment files, so a lazy-loaded library never has to be imported by the eager shell.

/** The hosted or local OVDB server the saved query reads from, or the static files published with the app. */
export type DemoDataSource =
  | { readonly kind: 'ovdb'; readonly baseUrl: string }
  | { readonly kind: 'static' };

export interface DemoConfig {
  /** The `demoRoute` flag. The route is not registered at all when false. */
  readonly enabled: boolean;
  readonly dataSource: DemoDataSource;
  /**
   * Development and e2e only: allow `localStorage['datatug.demo.dataSource']` ('static', or an OVDB base URL)
   * to override the source, so one build can exercise both adapters and a dead server.
   */
  readonly allowDataSourceOverride: boolean;
}

export const DEMO_DATA_SOURCE_OVERRIDE_KEY = 'datatug.demo.dataSource';
/** Where the static files live, relative to the app's origin. */
export const DEMO_STATIC_DATA_PATH = '/assets/demo-data/ovdb';

export function parseDemoConfig(raw: unknown): DemoConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const source = value['dataSource'] as Record<string, unknown> | undefined;
  if (typeof value['enabled'] !== 'boolean' || !source) return undefined;
  if (source['kind'] === 'static') return { enabled: value['enabled'], dataSource: { kind: 'static' }, allowDataSourceOverride: value['allowDataSourceOverride'] === true };
  if (source['kind'] === 'ovdb' && typeof source['baseUrl'] === 'string') {
    return { enabled: value['enabled'], dataSource: { kind: 'ovdb', baseUrl: source['baseUrl'] }, allowDataSourceOverride: value['allowDataSourceOverride'] === true };
  }
  return undefined;
}

/** The source to use now: the config's, unless an allowed override says otherwise. */
export function resolveDemoDataSource(config: DemoConfig, override: string | null | undefined): DemoDataSource {
  if (!config.allowDataSourceOverride || !override) return config.dataSource;
  if (override === 'static') return { kind: 'static' };
  return { kind: 'ovdb', baseUrl: override };
}
