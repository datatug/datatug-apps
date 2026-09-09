# Integration points (for a later task, after S2 lands)

This library is intentionally not wired into any existing page, route or service in
`libs/datatug/main` or `apps/datatug-app` — that's plan task 8/9's page-integration half,
scheduled after stream S2 (`fix/phase0-web-agent-contract`) lands its agent-URL builder
and store-id parsing. This file is the map for that follow-up task.

## 1. Provide the agent base URL

`SemanticApiService` reads its base URL from `DATATUG_AGENT_BASE_URL`
(`libs/datatug/semantic/src/lib/tokens/datatug-agent-base-url.token.ts`), defaulting to
`http://localhost:8989/datatug`. Once S2's URL builder exists (it resolves a store id like
`localhost:8989` to the agent's base URL), provide the token near where that builder is
constructed — most likely `apps/datatug-app/src/main.ts` alongside the existing
`SneatApiBaseUrl` provider, or per-route if the agent URL can vary by store:

```ts
{ provide: DATATUG_AGENT_BASE_URL, useFactory: () => urlBuilder.agentBaseUrl(storeId) }
```

Do not import anything from this library's internals into S2's files or vice versa; the
token is the only coupling point, by design.

## 2. Semantic markers in the grid

`SemanticMarkerComponent` (`entity`, `field`, `provenance` inputs) renders the header
adornment + tooltip from REQ:semantic-markers-in-grid. Drop it into
`libs/datatug/main/src/lib/pages/signed-in/env-db-table/env-db-table.page.ts`'s grid
column-header renderer (the `@sneat/datagrid`/Tabulator `headerFormatter` /
`titleFormatter` hook used to build `IGridDef.columns`), once that page calls
`SemanticApiService.getSemanticColumns({ project, source, collection })` to get the
per-column mapping. The AC (`mapped-columns-marked`) requires markers to come only from
that endpoint — never evaluate `NamePatterns` in the browser.

## 3. Context panel on cell click

`ContextPanelComponent` (`project` and `selection` inputs, `openQuery` output) replaces
the hard-coded sample content in `@sneat/datagrid`'s bundled `CellPopoverComponent` (see
the Web UI audit, "What is mocked"). On a cell click in `env-db-table.page.ts`, build a
`SemanticSelection` from the clicked cell using the same `semantic/columns` response
already fetched for point 2 (map the clicked column to its `entity`/`field`, with
`source` = the grid's source/collection id), and pass it to
`<sneat-datatug-context-panel [project]="..." [selection]="..." (openQuery)="...">`.
Handle `openQuery` by navigating to the query page with `queryId` and `bindings` — this
library deliberately does not depend on `@angular/router` or `DatatugNavService` so it
stays decoupled from S2/S8's routing.

## 4. Investigation Context bar, visible on every project screen

REQ:context-basket requires the context to be visible (collapsed by default, count
shown) on every project screen. Drop `InvestigationContextBarComponent` into the
project-level shell — `libs/datatug/main/src/lib/components/project/project-menu-top/`
or wherever the project page toolbar lives — reading `InvestigationContextService`
directly (no inputs needed). For a genuinely collapsed default, wrap it in the host
page's own collapse/expand affordance keyed off
`InvestigationContextService.enabledCount()`; that toggle is host-page UI, not part of
this library.

## 5. Limitation header on results

`LimitationHeaderComponent` (`limitations` input) renders REQ:limitation-visible. Drop
it above the results grid on the query page and the table page, fed from
`RunQueryResponse.limitations` (`SemanticApiService.runQuery(...)`) or
`SemanticRelatedRowsResponse.limitations` (`SemanticApiService.getRelatedRows(...)`).
`RunQueryResponse.bindingsApplied` (REQ:no-hidden-filters — "the results header MUST
list the bindings that were applied") is modelled in `models.ts` but has no dedicated
renderer in this stream; the query page can render it directly or a follow-up can add a
small component for it.

## 6. Parameter auto-binding on the query page (task 9)

For each `ParameterDef` with a semantic `meta` (`{entity, field}`), the query page should:

1. Check the current selection first (REQ:parameter-auto-binding — selection wins over
   context).
2. Otherwise call `InvestigationContextService.bindingsFor(parameters)` — pass an array
   of `{ id, meta }` (the parameter's id and its `EntityFieldRef`, no need to import the
   page's full `IParameterDef` shape).
3. Show the resulting value with its origin (`from selection` / `from context`) as a
   chip the user can clear or override (REQ:parameter-auto-binding), and only include it
   in the run's `parameters` once shown — never bind silently (REQ:no-hidden-filters).

## Notes / deviations from a literal reading of the brief

- Components inject `SemanticApiService` and `InvestigationContextService` directly
  (rather than taking them as inputs) so a host page only has to place the tag — this
  was a judgment call in the brief's spirit of minimizing S2/S8's later integration
  work; flag it in review if a different DI shape is preferred.
- Each component self-registers the few `ionicons` names it uses via `addIcons(...)` at
  module load, so the host app's `register-ionicons.ts` does not need to change to reuse
  markers/chips this library defines. `addIcons` merges into the global icon map, so
  calling it multiple times (once per component module) is safe.
- `InvestigationContextService`'s "plus the current environment" clause in
  REQ:context-basket is not implemented here: the store/project/environment selection
  lives in `libs/datatug/main`'s nav services, which this stream must not import. A
  later integration task should decide whether that belongs on this service or stays a
  host-page concern.
