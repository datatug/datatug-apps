import { NgModule } from '@angular/core';
import { ProjectService } from './project.service';

@NgModule({
  providers: [
    // ProjectService is not yet providedIn: 'root' — lane S126
    // (fix/title-load-flake) roots it separately.
    ProjectService,
  ],
})
export class DatatugServicesProjectModule {}
