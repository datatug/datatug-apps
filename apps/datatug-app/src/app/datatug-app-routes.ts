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
    path: '',
    loadChildren: () =>
      import('@sneat/datatug-main').then((m) => m.DatatugRoutingModule),
  },
];
