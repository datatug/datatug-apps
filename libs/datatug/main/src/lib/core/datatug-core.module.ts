import { NgModule } from '@angular/core';
import { QueryParamsService } from './services/QueryParamsService';

@NgModule({
  providers: [
    // AppContextService is providedIn: 'root' — not re-listed here, that
    // would shadow the root singleton in every importing injector.
    QueryParamsService,
  ],
})
export class DatatugCoreModule {}
