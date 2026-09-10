import { NgModule } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';

@NgModule({
  imports: [HttpClientModule],
  // `ProjectItemServiceFactory` used to be listed here — it's
  // `providedIn: 'root'` now (S157: a module-level entry would shadow the
  // root singleton in every injector that imports this module, same trap
  // PR #96/#115 fixed for other services; see `project-item-service.ts`'s
  // own comment for why), so it's resolved from root instead.
})
export class ProjItemServiceModule {}
