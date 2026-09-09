import { getStoreUrl } from '@sneat/api';

/**
 * Every DataTug CLI agent HTTP endpoint is registered under this path
 * prefix (`datatug-cli/pkg/server/endpoints/register.go` →
 * `registerRoutes()`: `path = strings.TrimRight(path, "/") + "/datatug"`).
 * Before this fix, every client call built a URL without it, so every
 * agent-backed request 404'd against a real `datatug serve` instance.
 */
export const AGENT_API_PATH_PREFIX = '/datatug';

/**
 * Builds the full URL for a DataTug CLI agent endpoint.
 *
 * @param storeId a store id as accepted by `getStoreUrl()` (from
 *   `@sneat/api`) — e.g. `"localhost:8989"`, `"http-example.com"`, or
 *   `"firestore"`.
 * @param endpointPath the endpoint's path *relative to* the `/datatug`
 *   prefix, e.g. `"agent-info"` or `"/entities/all_entities"` — see the
 *   client-call → server-route table below for the full set this app uses.
 */
export function buildAgentUrl(storeId: string, endpointPath: string): string {
  const origin = getStoreUrl(storeId);
  const normalizedPath = endpointPath.startsWith('/')
    ? endpointPath
    : `/${endpointPath}`;
  return `${origin}${AGENT_API_PATH_PREFIX}${normalizedPath}`;
}

/**
 * Map of every relative path this app's agent client passes to
 * `buildAgentUrl()`, to the CLI server route it is expected to hit
 * (`datatug-cli/pkg/server/endpoints/register.go`), and the client call
 * site(s) that use it. Kept here — next to the one function that turns a
 * relative path into a URL — as the reference for an e2e test asserting the
 * client actually reaches the routes the CLI server registers.
 *
 * | Client relative path                | Server route (`/datatug` + …)         | Client call site(s) |
 * |--------------------------------------|----------------------------------------|----------------------|
 * | `/agent-info`                        | `GET /agent-info`                       | `agent-state.service.ts` (`AgentStateService.watchAgentInfo`) |
 * | `/projects/projects_summary`         | `GET /projects/projects_summary`        | `datatug-store.service.ts` (`DatatugStoreService.getProjects`) |
 * | `/projects/project_summary`          | `GET /projects/project_summary`         | `project.service.ts` (`ProjectService.getProjectSummaryRequest`) |
 * | `/projects/project_full`             | `GET /projects/project_full`            | `project.service.ts` (`ProjectService.getFull`) |
 * | `/projects/create_project`           | `POST /projects/create_project`         | not called directly — `ProjectService.createNewProject` posts to the Firestore-backed `sneat-go` path instead (separate, pre-existing bug; out of this fix's scope) |
 * | `/projects/delete_project`           | `DELETE /projects/delete_project`       | not currently called by the client |
 * | `/folders/create_folder`             | `PUT /folders/create_folder`            | not currently called by the client |
 * | `/folders/delete_folder`             | `DELETE /folders/delete_folder`         | not currently called by the client |
 * | `/queries/get_query`                 | `GET /queries/get_query`                | `project-item-service.ts` (`ProjectItemService.getProjItem`, itemsPath="queries") |
 * | `/queries/create_query`              | `POST /queries/create_query`            | `project-item-service.ts` (`ProjectItemService.createProjItem`) |
 * | `/queries/update_query`              | `PUT /queries/update_query`             | `project-item-service.ts` (`ProjectItemService.updateProjItem`) |
 * | `/queries/delete_query`              | `DELETE /queries/delete_query`          | `project-item-service.ts` (`ProjectItemService.deleteProjItem`) |
 * | `/queries/all_queries`               | commented out server-side (`register.go`), route does not exist | `project-item-service.ts` (`ProjectItemService.getProjItems`/`getFolder`, itemsPath="queries") — pre-existing gap, flagged here rather than "fixed" since there is no server route to fix it against |
 * | `/boards/board`                      | `GET /boards/board`                     | `datatug-board.service.ts` (`DatatugBoardService.getBoard` — currently dead code, throws "not implemented" before making the call) |
 * | `/boards/create_board`               | `POST /boards/create_board`             | `datatug-board.service.ts` (`DatatugBoardService.createNewBoard` — routes through `SneatApiServiceFactory`, i.e. the Firestore-backed `sneat-go` path, not this agent builder; separate pre-existing bug, out of scope) |
 * | `/boards/save_board`                 | `PUT /boards/save_board`                | not currently called by the client |
 * | `/boards/delete_board`               | `DELETE /boards/delete_board`           | not currently called by the client |
 * | `/environment-summary`               | `GET /environment-summary`              | `environment.service.ts` (`EnvironmentService.getEnvSummary`) |
 * | `/dbserver-summary`                  | `GET /dbserver-summary`                 | `db-server.service.ts` (`DbServerService.getDbServerSummary`) |
 * | `/dbserver-databases`                | `GET /dbserver-databases`               | `db-server.service.ts` (`DbServerService.getServerDatabases`) |
 * | `/dbserver-add`                      | `POST /dbserver-add`                    | `db-server.service.ts` (`DbServerService.addDbServer`) |
 * | `/dbserver-delete`                   | `DELETE /dbserver-delete`               | `db-server.service.ts` (`DbServerService.deleteDbServer`) |
 * | `/entities/all_entities`             | `GET /entities/all_entities`            | `entity.service.ts` (`EntityService.getAllEntities`) |
 * | `/entities/entity`                   | `GET /entities/entity`                  | `entity.service.ts` (`EntityService.getEntity`) |
 * | `/entities/create_entity`            | `POST /entities/create_entity`          | `entity.service.ts` (`EntityService.createEntity`) |
 * | `/entities/save_entity`              | `PUT /entities/save_entity`             | `entity.service.ts` (`EntityService.saveEntity`) |
 * | `/entities/delete_entity`            | `DELETE /entities/delete_entity`        | `entity.service.ts` (`EntityService.deleteEntity`) |
 * | `/recordsets/*`                      | full CRUD registered server-side        | not currently called by the client — `RecordsetService` is an empty class (see web-ui audit) |
 * | `/exec/execute_commands`             | `POST /exec/execute_commands`           | `agent.service.ts` (`AgentService.execute`) |
 * | `/exec/select`                       | `GET /exec/select`                      | `agent.service.ts` (`AgentService.select`) |
 */
