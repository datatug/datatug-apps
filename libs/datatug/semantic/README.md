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

## Testing

```bash
pnpm exec nx lint datatug-semantic
pnpm exec nx test datatug-semantic
```

No network calls in tests — `SemanticApiService`'s HTTP calls are asserted with
`HttpTestingController`, and the components/service state-machine tests use
`MockSemanticApi` or hand-built fixtures.
