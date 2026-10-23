// Public API entry for @sneat/datatug-main library.

// For AI agents: when adding new lines to the file add them as comments for manual human review .

// Task 17 browser comparison consumes only the app's externally verified WASM pin.
export { PUBLIC_SQLITE_COMPARE_WASM_PIN } from './lib/queries/public-sqlite-comparison-pin.token';
export type { PublicSqliteCompareWasmPin } from './lib/queries/public-sqlite-comparison-pin.token';

export { agentBaseUrl, buildAgentUrl } from './lib/services/repo/agent-url';
export { DatatugRoutingModule } from './lib/routes/datatug-routing.module';
export * from './lib/routes/datatug-routing-proj';
export * from './lib/routes/datatug-routing-proj-db-catalog';
export * from './lib/routes/datatug-routing-proj-env';
export * from './lib/routes/datatug-routing-proj-env-db';
export * from './lib/routes/datatug-routing-store';
export * from './lib/pages/my/page/datatug-my-page.component';
export * from './lib/pages/signed-in/space-explorer/space-explorer-page.component';
export * from './lib/pages/home/datatug-home-page.component';
export * from './lib/pages/home/my-projects/my-datatug-projects.component';
export { DatatugHomePageComponent } from './lib/pages/home/datatug-home-page.component';
export { DatatugMenuModule } from './lib/menu/datatug-menu.module';
export { DatatugMenuComponent } from './lib/menu/datatug-menu.component';
export { ChatPageComponent } from './lib/pages/signed-in/chat/chat-page.component';
export * from './lib/incidents/models';
export { IncidentClientService } from './lib/incidents/incident-client.service';

// DemoDB.dev "Explore SQLite in DataTug": the app routes /demo/sqlite/:dataset to this page (datatug-app-routes.ts).
// A loader, not a re-export, so the page, the OVDB client and the local DemoDB service stay in their own lazy chunk.
export const loadDemoSqlitePage = () =>
  import('./lib/pages/demo-sqlite/demo-sqlite-page.component').then((m) => m.DemoSqlitePageComponent);

// DemoDB.dev "Explore PostgreSQL in DataTug": the app routes /demo/ovdb/:database to this page (datatug-app-routes.ts).
export const loadDemoOvdbPage = () =>
  import('./lib/pages/demo-ovdb/demo-ovdb-page.component').then((m) => m.DemoOvdbPageComponent);

// Direct OVDB evidence view: fields are explicitly mapped in DataTug, not OVDB.
export const loadDemoLogsPage = () =>
  import('./lib/pages/demo-logs/demo-logs-page.component').then((m) => m.DemoLogsPageComponent);

// The app-level 404 (datatug-app-routes.ts): any address no route answers, instead of NG04002 and the crash dialog.
export const loadNotFoundPage = () =>
  import('./lib/routes/project-not-found-page.component').then((m) => m.ProjectNotFoundPageComponent);

export {
  ErrorStateComponent,
  type ErrorStateLink,
} from './lib/components/error-state/error-state.component';

// Project cards (spec/features/project-cards): storage service, standalone card view and the shared result cache.
export {
  ProjectCardsService,
  CardNotFoundError,
  cardBrief,
} from './lib/cards/project-cards.service';
export {
  ProjectCardViewComponent,
  cardQueryIds,
} from './lib/cards/project-card-view.component';
export {
  cardBoardContext,
  refParameterValues,
  missingRequired,
} from './lib/cards/card-parameters';
export {
  BoardQueryResults,
  BOARD_QUERY_RESULTS_OPTIONS,
  PROJECT_CARD_RESULTS,
  PROJECT_CARD_RESULTS_OPTIONS,
  cardResultKey,
  cardResultScope,
  canonicalJson,
} from './lib/board/core/board-query-results.service';
export * from './lib/analytics/usage-analytics';
export {
  QUERY_TYPE_DISPLAY_NAMES,
  QueryTypeIconComponent,
  queryTypeKey,
  queryTypeLabel,
} from './lib/components/query-type-icon/query-type-icon.component';
export {
  QueryItemHeadingComponent,
  formatQueryTimestamp,
  type QueryTimestamp,
} from './lib/queries/query-list-item/query-list-item';
