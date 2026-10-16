# @sneat/datatug-semantic

Foundation library for DataTug's core investigation loop (Phase 1, plan tasks 8-9,
component/service half): the semantic API client, the Investigation Context ("basket"),
and the standalone Ionic components that render meaning, related records, applicable
queries and policy limitations.

Implements the hub Feature `core-investigation-loop`
(`datatug/datatug:spec/features/core-investigation-loop/README.md`) journeys J2-J4 at
the service/component level. It does not wire into any existing page or route — see
[`INTEGRATION.md`](./INTEGRATION.md) for the exact injection points a later task will use.

## What's in here

- `SemanticApiService` — typed HTTP client for the five `/datatug/semantic/*`,
  `/datatug/queries/applicable` and `/datatug/exec/run_query` endpoints. Base URL comes
  from the `DATATUG_AGENT_BASE_URL` injection token (default
  `http://localhost:8989/datatug`).
- `MockSemanticApi` — in-memory test double with the same method shape, used by this
  library's own specs and available for a host page's tests.
- `InvestigationContextService` — the session-scoped Investigation Context: add/remove/
  disable a semantic value, `bindingsFor(parameters)` to find candidate parameter
  bindings. Never filters or binds a query by itself (REQ:no-hidden-filters).
- `ContextPanelComponent`, `InvestigationContextBarComponent`,
  `LimitationHeaderComponent`, `SemanticMarkerComponent` — standalone, Ionic
  list/chip-based, dense.

## Monthly bar race input

`prepareBarRace` accepts a complete, untruncated, unrestricted chart recordset
with validated rights for every used source. Its `runtime` discriminant keeps a
server `Result` and its execution profile distinct from a browser public API
receipt, which has no server execution profile. Chart results are presentation
state and are never written into a board definition.

`transformOrdersMonthlyCountryCount` accepts admitted raw order rows and a saved
column mapping. It rejects duplicate IDs, invalid ISO dates, missing countries,
partial pages and missing rights. It produces `period` (YYYY-MM), `category`
(country) and `value` (distinct order count) with explicit zero rows for every
month and country, plus source lineage. The same transformed recordset feeds the
grid and chart; the caller compares its returned count and span with the pinned
Northwind evidence before labelling the 830-order showcase complete.

`prepareBarRace` then accepts a result column containing canonical `YYYY-MM` strings.
It fills every missing calendar month between the first and last observed month
with zero period values or carried cumulative values, up to 240 frames. Typed
dates and datetimes are rejected until the chart specification declares a time
grain and its gap policy. The source, execution or public API receipt, rights,
and limitation metadata stays attached.

## Testing

```bash
pnpm exec nx lint datatug-semantic
pnpm exec nx test datatug-semantic
```

No network calls in tests — `SemanticApiService`'s HTTP calls are asserted with
`HttpTestingController`, and the components/service state-machine tests use
`MockSemanticApi` or hand-built fixtures.
