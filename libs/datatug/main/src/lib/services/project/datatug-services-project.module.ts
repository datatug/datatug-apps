import { NgModule } from '@angular/core';

// `ProjectService` and `ProjectContextService` are both `providedIn: 'root'`
// — do not re-list them in `providers:` here. Every standalone component
// that imports this module gets its own environment injector, and a
// module-level provider entry shadows the root singleton there (two
// `ProjectService` instances meant two HTTP GETs for one project summary,
// confirmed live during the S126 title-load-flake investigation).
@NgModule({})
export class DatatugServicesProjectModule {}
