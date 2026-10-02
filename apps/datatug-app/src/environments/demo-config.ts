/**
 * The demo flag, per environment (design: datatug/backstage docs/design/demo-as-github-project.md, 6.5, task G-F1).
 *
 * Every environment file exports `datatugDemoConfig`. `enabled` is `true` only in development (`environment.ts`),
 * which is never deployed, and `false` in every environment that ships: production and the SSO end-to-end build.
 * Nothing reads it yet; when something does, it reads it through `isDemoEnabled()` (src/app/demo-flag.ts), never
 * from this object directly, so that the runtime override of 6.5 applies in one place.
 */
export interface DatatugDemoConfig {
  /** Whether the demo behaviours (running `msg`, the investigation turn, prepared questions) are on in this build. */
  readonly enabled: boolean;
}
