import { datatugDemoConfig } from '../environments/environment';

// The demo flag (design: datatug/backstage docs/design/demo-as-github-project.md, 6.5, task G-F1). Nothing reads
// it yet: the tasks that add demo behaviour read it here and nowhere else.
//
// Two inputs, in this order:
//   1. The runtime override, `localStorage['datatug.demo.enabled']`: '0' turns the demo OFF even in a build that
//      has it on; '1' turns it ON in a build that has it off (how the real production host is tested before
//      anyone flips the flag). Any other value, or no value, means "no opinion".
//   2. The build's `datatugDemoConfig.enabled` (src/environments/*).
//
// The override is the browser's own: it is read from `localStorage` and from nothing else. Not from the address
// (no query parameter, no fragment), not from a cookie, not from a project's files or any response: whoever
// controls a link or a repository cannot switch the demo on or off for a visitor. demo-flag.spec.ts pins that,
// and that this file reads no such source. Trust (which repositories may show a hand-off's text, which projects
// may run it) is decided on its own, in demo-handoff-capture.ts and the project checks, never by this flag.

export const DEMO_ENABLED_OVERRIDE_KEY = 'datatug.demo.enabled';

/** The decision from the two inputs: the stored override when it is '0' or '1', else the build's value. */
export function resolveDemoEnabled(
  built: boolean,
  override: string | null | undefined,
): boolean {
  if (override === '0') return false;
  if (override === '1') return true;
  return built;
}

/** The override as stored in this browser; undefined when there is none or storage is blocked. */
function storedOverride(storage: () => Storage): string | undefined {
  try {
    return storage().getItem(DEMO_ENABLED_OVERRIDE_KEY) ?? undefined;
  } catch {
    return undefined; // blocked storage: no override
  }
}

/** Whether the demo is on for this visitor, in this build. */
export function isDemoEnabled(
  built: boolean = datatugDemoConfig.enabled,
  storage: () => Storage = () => window.localStorage,
): boolean {
  return resolveDemoEnabled(built, storedOverride(storage));
}
