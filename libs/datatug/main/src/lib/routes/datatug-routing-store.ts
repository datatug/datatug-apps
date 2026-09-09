import { RouterModule, Routes } from '@angular/router';
import { NgModule } from '@angular/core';
import { ENABLE_EMPTY_SHELL_PAGES } from '../core/feature-flags';
import { routingParamProjectId } from '../core/datatug-routing-params';

// Diff is one of the empty-shell pages — see `ENABLE_EMPTY_SHELL_PAGES`.
const emptyShellStoreRoutes: Routes = [
  {
    path: 'diff',
    loadComponent: () =>
      import('../pages/signed-in/diff/diff-page.component').then(
        (m) => m.DiffPageComponent,
      ),
  },
];

export const datatugStoreRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../pages/signed-in/store/datatug-store-page.component').then(
        (m) => m.DatatugStorePageComponent,
      ),
  },
  ...(ENABLE_EMPTY_SHELL_PAGES ? emptyShellStoreRoutes : []),
  {
    path: 'project/:' + routingParamProjectId,
    loadChildren: () =>
      import('./datatug-routing-proj').then(
        (m) => m.DatatugProjectRoutingModule,
      ),
  },
  {
    path: 'project',
    redirectTo: '',
  },
  {
    path: 'environment',
    loadComponent: () =>
      import('../pages/signed-in/environment/environment-page.component').then(
        (m) => m.EnvironmentPageComponent,
      ),
  },
];

@NgModule({
  imports: [RouterModule.forChild(datatugStoreRoutes)],
  exports: [RouterModule],
})
export class DatatugStoreRoutingModule {}
