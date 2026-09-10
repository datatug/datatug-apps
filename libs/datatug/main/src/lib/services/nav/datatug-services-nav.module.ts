import { NgModule } from '@angular/core';
import { DatatugServicesProjectModule } from '../project/datatug-services-project.module';

// DatatugNavService and DatatugNavContextService are both
// `providedIn: 'root'` — do not re-list them in `providers:` here, that
// would shadow the root singleton in every injector that imports this
// module.
@NgModule({
  imports: [DatatugServicesProjectModule],
})
export class DatatugServicesNavModule {}
