import { InjectionToken } from '@angular/core';

/**
 * Base URL of the local DataTug agent's `/datatug` API, e.g. `http://localhost:8989/datatug`.
 *
 * {@link SemanticApiService} appends the endpoint's own path (e.g. `/semantic/columns`) to
 * this value — it never re-adds a `/datatug` prefix, so the token's value must already
 * include it, matching the route table in `pkg/server/endpoints/routes.go` (REQ:agent-path-contract).
 *
 * The stream building the URL builder / store-id parsing (S2, `fix/phase0-web-agent-contract`)
 * should provide this token from its own resolved agent base URL once it lands; until then
 * this default keeps the library usable standalone against a locally running `datatug serve`.
 */
export const DATATUG_AGENT_BASE_URL = new InjectionToken<string>(
  'DATATUG_AGENT_BASE_URL',
  {
    providedIn: 'root',
    factory: () => 'http://localhost:8989/datatug',
  },
);
