import { ActionSheetController } from '@ionic/angular';
import { Injectable, inject } from '@angular/core';
import { IProjectRef } from '../core/project-context';
import { QueryType } from '../models/definition/query-def';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { QueryEditorStateService } from './query-editor-state-service';
import { RandomIdService } from '@sneat/random';

// `providedIn: 'root'` — same S157 fix, same reason, as
// `QueryEditorStateService` (this file's own `queryEditorStateService`
// dependency): a plain `@Injectable()` provided only via
// `DatatugQueriesUiModule`'s `providers:` array left `QueriesMenuComponent`
// (side-menu "Active Queries" tab) unable to construct — nothing in its
// ancestor chain imports that module. See `query-editor-state-service.ts`'s
// own comment for the full story.
@Injectable({ providedIn: 'root' })
export class QueriesUiService {
  private readonly randomIdService = inject(RandomIdService);
  private readonly actionSheet = inject(ActionSheetController);
  private readonly queryEditorStateService = inject(QueryEditorStateService);
  private readonly nav = inject(DatatugNavService);

  async openNewQuery(projectRef: IProjectRef): Promise<void> {
    const createNewQuery = (type: QueryType) => () => {
      const id = this.randomIdService.newRandomId({ len: 7 });
      const queryState = this.queryEditorStateService.newQuery({
        id: id,
        isNew: true,
        queryType: type,
        def: {
          id,
          draft: true,
          request: {
            queryType: QueryType.HTTP,
          },
        },
      });
      if (queryState.def) {
        this.nav.goQuery({ ref: projectRef }, queryState.def);
      }
    };
    const actionSheet = await this.actionSheet.create({
      header: 'New query',
      subHeader: 'Select type of query to be created',
      buttons: [
        {
          text: 'SQL',
          role: 'selected',
          handler: createNewQuery(QueryType.SQL),
        },
        {
          // icon: 'browser-outline',
          text: 'HTTP',
          role: 'selected',
          handler: createNewQuery(QueryType.HTTP),
        },
        {
          // icon: 'cancel',
          text: 'Cancel',
          role: 'cancel',
        },
      ],
    });
    await actionSheet.present();
    // const result = await actionSheet.onDidDismiss();
    // console.log('onDidDismiss resolved with role', result)
  }
}
