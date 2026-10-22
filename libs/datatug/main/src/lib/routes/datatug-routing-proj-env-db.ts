import { RouterModule, Routes } from '@angular/router';
import { NgModule } from '@angular/core';
import { routingParamTableType } from '../core/datatug-routing-params';

export const datatugProjEnvDbRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../pages/signed-in/env-db/env-db-page.component').then(
        (m) => m.EnvDbPageComponent,
      ),
  },
  // The Table records and Record cards' links (Feature claude-mod-web-links): before the table route, which
  // would otherwise match the first two segments.
  {
    path: 'table/:' + routingParamTableType + '/records',
    loadComponent: () =>
      import('../agent-links/table-records/table-records.page').then(
        (m) => m.TableRecordsPageComponent,
      ),
  },
  {
    path: 'table/:' + routingParamTableType + '/record',
    loadComponent: () =>
      import('../agent-links/table-record/table-record.page').then(
        (m) => m.TableRecordPageComponent,
      ),
  },
  {
    path: 'view/:' + routingParamTableType + '/records',
    loadComponent: () =>
      import('../agent-links/table-records/table-records.page').then(
        (m) => m.TableRecordsPageComponent,
      ),
  },
  {
    path: 'view/:' + routingParamTableType + '/record',
    loadComponent: () =>
      import('../agent-links/table-record/table-record.page').then(
        (m) => m.TableRecordPageComponent,
      ),
  },
  {
    path: 'table/:' + routingParamTableType,
    loadComponent: () =>
      import('../pages/signed-in/env-db-table/env-db-table.page').then(
        (m) => m.EnvDbTablePageComponent,
      ),
  },
  {
    path: 'view/:' + routingParamTableType,
    loadComponent: () =>
      import('../pages/signed-in/env-db-table/env-db-table.page').then(
        (m) => m.EnvDbTablePageComponent,
      ),
  },
];

@NgModule({
  imports: [RouterModule.forChild(datatugProjEnvDbRoutes)],
  exports: [RouterModule],
})
export class DatatugProjEnvDbRoutingModule {}
