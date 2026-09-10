import { NgModule } from '@angular/core';
import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { DatatugStoreService } from './datatug-store.service';
import { AgentStateService } from './agent-state.service';
import { AgentService } from './agent.service';

@NgModule({
  providers: [
    provideHttpClient(withInterceptorsFromDi()),
    // StoreApiService, DatatugStoreServiceFactory, DatatugStoreFirestoreService
    // and DatatugStoreGithubService are all providedIn: 'root' — none of
    // them is re-listed here, since a module-level provider entry would
    // shadow the root singleton in every injector that imports this module
    // (nav-context-root-singletons pattern, see PR #96 and
    // nav/nav-services-singleton.spec.ts). A routed standalone component
    // that lists DatatugServicesStoreModule directly in its own
    // @Component.imports (e.g. BoardsPageComponent) would otherwise get its
    // OWN, shadowed instance of each — concretely a problem for
    // DatatugStoreGithubService, whose per-instance summaryCache would then
    // not be shared with the app-wide singleton, causing redundant
    // datatug-project.json fetches. Root HttpClient is resolved instead of
    // this module's own provideHttpClient(withInterceptorsFromDi()) —
    // behavior-neutral, no DI HTTP interceptors are registered anywhere in
    // this app.
    DatatugStoreService,
    AgentService,
    AgentStateService,
  ],
})
export class DatatugServicesStoreModule {}
