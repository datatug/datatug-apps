import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'hello-world',
    loadChildren: () =>
      import('./hello-world-page.component').then(
        (m) => m.HelloWorldPageComponent,
      ),
  },
  {
    path: 'debug',
    loadComponent: () =>
      import('./debug-page.component').then((m) => m.DebugPageComponent),
  },
  {
    // The side menu is lazy-loaded into the named "menu" outlet in the app
    // shell, so it is code-split out of the initial bundle and the router (not
    // a static import) handles its loading.
    path: '',
    outlet: 'menu',
    loadComponent: () =>
      import('@sneat/datatug-main').then((m) => m.DatatugMenuComponent),
  },
  {
    path: '',
    loadChildren: () =>
      import('@sneat/datatug-main').then((m) => m.DatatugRoutingModule),
  },
];
