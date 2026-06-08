import { NgModule } from '@angular/core';
import { AppContextService } from './services/app-context.service';
import { QueryParamsService } from './services/QueryParamsService';

@NgModule({
  providers: [
    AppContextService,
    QueryParamsService,
  ],
})
export class DatatugCoreModule {}
