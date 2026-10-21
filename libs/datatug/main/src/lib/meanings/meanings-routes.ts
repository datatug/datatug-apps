import type { Routes } from '@angular/router';
export const projectMeaningsRoutes: Routes = [
  ['meanings', 'list'],
  ['meanings/new-entity', 'new-entity'],
  ['meanings/entity', 'entity'],
  ['meanings/new-field', 'new-field'],
  ['meanings/field', 'field'],
].map(([path, meaningMode]) => ({
  path,
  data: { meaningMode },
  loadComponent: () =>
    import('./meanings-page.component').then(
      (module) => module.MeaningsPageComponent,
    ),
}));
