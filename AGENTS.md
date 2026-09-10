<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Change detection & state (zoneless)

The app **is zoneless**: `apps/datatug-app/src/main.ts` calls `provideZonelessChangeDetection()`, and `apps/datatug-app/project.json`'s `polyfills` is `[]` — there is no Zone.js in this app (it is not even a direct dependency; it only appears in `pnpm-lock.yaml` as a peer-dep range some Angular packages declare but never actually need here).

**All new code and changes must follow the zoneless approach:**

- Expose component state to templates via **signals** (`signal()`, `computed()`, `linkedSignal()`), not plain mutable fields. Read them in templates with `()` (e.g. `@if (!isLoginPage())`).
- Never rely on Zone.js to notice async state changes — signal writes notify change detection directly, so components stay correct.
- Prefer `OnPush` and signal-based patterns for all components.

## The bug this causes, and the fix recipe

Assigning a plain class field (`this.foo = value;`) from inside an RxJS `.subscribe()` callback, a promise `.then()`/`.catch()`/`.finally()` callback, or a `setTimeout()`/`setInterval()` callback never schedules a repaint by itself — nothing tells Angular's zoneless scheduler that component state changed. The template then shows stale content (often a literal "Loading..." placeholder) until some *unrelated* event happens to trigger a global change-detection pass (e.g. the user clicks something else). This is exactly the bug the founder hit 2026-09-10 on the store/project page ("it does not show data until I click dropdown").

The fix, worked out in `libs/datatug/main/src/lib/pages/signed-in/project/project-page.component.ts` (PR #95) and applied fleet-wide since:

1. Change the field from a plain property to `readonly foo = signal<T>(initialValue);`.
2. Change every write from `this.foo = value;` to `this.foo.set(value);` (or `.update(fn)` for a derived write) — including a write reached via array/object destructuring assignment (`[this.a, this.b] = x.split(...)`) and a write made by a private method that is itself *called from* an async callback, not just a literal write inside the callback body.
3. Change every template read from `foo`/`foo?.bar` to `foo()`/`foo()?.bar`.
4. For a value written from a template event only (e.g. `[(ngModel)]` driven purely by user input, with no async writer) — that's already zoneless-safe as-is; no signal needed.
5. Add a unit test in the same shape as the fix commit's spec: use a `Subject` (not `of(value)`, which resolves synchronously before the first `detectChanges()` and would mask the bug) that emits strictly *after* the component has already rendered once, then assert the DOM updated via `fixture.whenStable()` with **no** subsequent manual `detectChanges()` call.

## `check:zoneless` — the durable control for this rule

`tools/check-zoneless-fields.mjs` (run via `pnpm run check:zoneless`, wired into CI's `build` job) statically scans every `*.component.ts` under `libs/**` and `apps/**` for exactly the bug shape above (a `this.<field>` write inside a tracked async callback, where `<field>` isn't declared as a signal) and fails the build if it finds one outside `tools/zoneless-allowlist.txt`. See that script's own file header for the detection rule, and its known limitations (it does not trace writes made by a method called from a callback, nor in-place mutation of a Record/array reachable from `this`).

`tools/zoneless-allowlist.txt` is a temporary carve-out for components not yet converted — it must only ever shrink. Converting a file removes it from the list; a newly authored file must never be added to it.
