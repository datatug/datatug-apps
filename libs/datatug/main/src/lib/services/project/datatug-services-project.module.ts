import { NgModule } from '@angular/core';
import { ProjectContextService } from './project-context.service';
import { ProjectService } from './project.service';

@NgModule({
  providers: [
    ProjectContextService,
    ProjectService,
  ],
})
export class DatatugServicesProjectModule {}
