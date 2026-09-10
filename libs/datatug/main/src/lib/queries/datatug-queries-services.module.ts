import { NgModule } from '@angular/core';
import { DatatugServicesStoreModule } from '../services/repo/datatug-services-store.module';
import { ProjItemServiceModule } from '../services/repo/project-item-service.module';
import { DatatugServicesUnsortedModule } from '../services/unsorted/datatug-services-unsorted.module';
import { QueryContextSqlService } from './query-context-sql.service';

@NgModule({
  imports: [
    DatatugServicesStoreModule,
    ProjItemServiceModule,
    DatatugServicesUnsortedModule,
  ],
  providers: [
    QueryContextSqlService,
    // `QUERY_PROJ_ITEM_SERVICE`, `QueriesService`, `QueryEditorStateService`
    // and `QueriesUiService` used to be listed here too — all four are
    // `providedIn: 'root'` now (S157: a module-level entry would shadow the
    // root singleton in every injector that imports this module, same trap
    // PR #96/#115 fixed for other services), so they're resolved from root
    // instead. See `query-editor-state-service.ts`'s own comment for why.
  ],
})
export class DatatugQueriesServicesModule {}
