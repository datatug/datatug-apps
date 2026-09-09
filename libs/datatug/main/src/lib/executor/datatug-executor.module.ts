import { NgModule } from '@angular/core';
import { DatatugServicesStoreModule } from '../services/repo/datatug-services-store.module';
import { Coordinator } from './coordinator';
import { HttpExecutor } from './executors/http-executor';

// `Coordinator`'s own constructor injects `HttpExecutor` directly
// (`inject(HttpExecutor)`), but this module only ever provided `Coordinator`
// itself — `AgentService` (Coordinator's other dependency) comes from
// `DatatugServicesStoreModule`, already imported below, but `HttpExecutor`
// had no provider anywhere in this app. Latent until lane S92: `Coordinator`
// had exactly one consumer (`QueryPageComponent`), and that component was
// never actually constructed in a live browser until journey J2/J3 first
// reached it — confirmed live: `NG0201: No provider found for
// \`HttpExecutor\`. Source: Standalone[_QueryPageComponent]`, one level
// deeper than the AppContextService gap this same stream also fixed
// (query-page.component.ts's own `imports:`).
@NgModule({
  imports: [DatatugServicesStoreModule],
  providers: [Coordinator, HttpExecutor],
})
export class DatatugExecutorModule {}
