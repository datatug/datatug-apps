# datatug-apps

Source code for **[DataTug.app](https://datatug.app)** — the hosted web UI (and mobile shell) of DataTug.

> DataTug is an open-source, CLI-first data exploration platform with a web UI. It lets you explore, query, and connect data across multiple sources without losing context. The project files (queries, dashboards, schema docs, and the semantic knowledge base) are the source of truth; this repo is the **browser-based view** over them. The terminal view lives in [`datatug-cli`](https://github.com/datatug/datatug-cli), and the marketing/docs front door is [datatug.io](https://datatug.io).
>
> This codebase was extracted from `sneat-apps` into this standalone repository. It still consumes shared UI/auth/data building blocks from the Sneat ecosystem as published `@sneat/*` packages.

<!-- dev-approach:v1 -->
## Our approach to development

We build with our own tooling:

- **[SpecScore](https://specscore.md)** — specify requirements as `SpecScore.md` artifacts
- **[SpecStudio](https://specscore.studio)** — author & manage specs across their lifecycle
- **[inGitDB](https://ingitdb.com)** — store structured data in Git where applicable
- **[DALgo](https://dalgo.io)** — data access layer for Go
- **[cover100.dev](https://cover100.dev)** — drive toward 100% test coverage
- **[DataTug](https://datatug.io)** — query & explore data
<!-- /dev-approach -->

## Tech stack

- **[Nx](https://nx.dev)** monorepo (`nx` 22)
- **[Angular](https://angular.dev)** 21 + **[Ionic](https://ionicframework.com)** 8 (PWA)
- **[Capacitor](https://capacitorjs.com)** for the native mobile shell (iOS/Android)
- **Firebase** (`@angular/fire`) — auth + Firestore
- **[Tabulator](https://tabulator.info)** for data grids, `@acrodata/code-editor` for the query editor
- **Sentry** (error tracking) + **PostHog** (product analytics)
- **Vitest** for unit tests
- Shared libraries from the Sneat ecosystem (`@sneat/*`)

## Projects

| Project | Path | Type |
|---|---|---|
| `datatug-app` | `apps/datatug-app` | Angular/Ionic application — the datatug.app UI |
| `datatug-main` | `libs/datatug/main` | The main DataTug feature library |
| `testing` | `libs/testing` | Shared test utilities |

## Quick start

This workspace uses **pnpm**. Prefix Nx commands with the package manager so the workspace-local CLI is used.

```bash
# Install dependencies
pnpm install

# Serve the app (Angular dev server, default http://localhost:4200)
pnpm nx serve datatug-app

# Build for production
pnpm nx build datatug-app

# Run unit tests (Vitest)
pnpm nx test datatug-app

# Lint
pnpm nx lint datatug-app

# Run a target across all projects
pnpm nx run-many -t lint test build

# Build only what's affected (useful in CI)
pnpm nx affected -t build test

# Visualize the project graph
pnpm nx graph
```

## Project structure

```
├── apps/
│   └── datatug-app/        - Angular + Ionic app (the datatug.app UI)
│       └── src/
│           ├── app/        - routes, components, pages
│           ├── environments/
│           └── ...         - Firebase, Ionicons, PostHog bootstrap
├── libs/
│   ├── datatug/main/       - the main DataTug feature library
│   └── testing/            - shared test utilities
├── nx.json                 - Nx configuration
├── tsconfig*.json          - TypeScript configuration
└── eslint.config.js        - ESLint config
```

## Coding conventions

### Change detection & state (zoneless-ready)

The app is **not yet fully zoneless** — Zone.js is still shipped (`apps/datatug-app/project.json` → `polyfills: ["zone.js"]`) because Ionic does not yet support zoneless change detection. We will drop Zone.js once Ionic supports it.

**All new code must follow the zoneless approach:**

- Expose component state to templates via **signals** (`signal()`, `computed()`), not plain mutable fields. Read them in templates with `()` (e.g. `@if (!isLoginPage())`).
- Never rely on Zone.js to notice async state changes — signal writes notify change detection directly, so components stay correct now and after the zoneless switch.
- Prefer `OnPush` and signal-based patterns for new components.

## Continuous integration

CI runs via GitHub Actions — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Related repositories

| Repo | What it is |
|---|---|
| [datatug-cli](https://github.com/datatug/datatug-cli) | The CLI / TUI / agent and the structured data primitives |
| [datatug-io](https://github.com/datatug/datatug-io) | Marketing + docs site at [datatug.io](https://datatug.io) |
| [DALgo](https://github.com/dal-go/dalgo) | Go database abstraction layer DataTug is built on |

## License

Open source, part of the [DataTug](https://datatug.io) project. A `LICENSE` file should be added to match the project's canonical license (the CLI ships under Apache-2.0).

---

<sub>Working with Nx in this repo? See [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) for the Nx workflow conventions.</sub>
