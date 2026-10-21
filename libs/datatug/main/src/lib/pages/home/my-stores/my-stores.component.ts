import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
} from '@ionic/angular';
import {
  allUserStoresAsFlatList,
  DatatugProjStoreType,
  IDatatugStoreBriefWithId,
} from '../../../models/interfaces';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';
import { AuthStatus } from '@sneat/auth-core';
import {
  IDatatugStoreContext,
  parseDatatugStoreRef,
} from '../../../nav/nav-models';
import { LoadingItemsComponent } from '../loading-items-component';
import { addIcons } from 'ionicons';
import {
  chevronForward,
  cloudOutline,
  logoGithub,
  terminalOutline,
} from 'ionicons/icons';

addIcons({
  'chevron-forward': chevronForward,
  'cloud-outline': cloudOutline,
  'logo-github': logoGithub,
  'terminal-outline': terminalOutline,
});

@Component({
  selector: 'sneat-datatug-my-stores',
  templateUrl: './my-stores.component.html',
  styleUrl: './my-stores.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LoadingItemsComponent,
    IonCard,
    IonCardContent,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonIcon,
    IonList,
  ],
})
export class MyStoresComponent implements OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly datatugUserService = inject(DatatugUserService);

  public readonly authStatus = signal<AuthStatus | undefined>(undefined);
  public readonly userRecordLoaded = signal(false);

  public readonly stores = signal<IDatatugStoreBriefWithId[] | undefined>(
    undefined,
  );

  public readonly storageOptions = [
    {
      type: 'firestore' as DatatugProjStoreType,
      title: 'DataTug Cloud',
      description: 'Fastest setup, with live updates from Cloud storage.',
    },
    {
      type: 'github' as DatatugProjStoreType,
      title: 'GitHub',
      description:
        'Keep control in your repository, with version history and branches.',
    },
    {
      type: 'agent' as DatatugProjStoreType,
      title: 'Local / DataTug CLI',
      description:
        'Work locally for fast access and offline use where supported.',
    },
  ] as const;

  private readonly destroyed = new Subject<void>();

  constructor() {
    this.datatugUserService.datatugUserState
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (datatugUserState) => {
          // console.log('MyStoresComponent => datatugUserState:', datatugUserState);
          this.authStatus.set(datatugUserState?.status);
          this.userRecordLoaded.set(
            !!datatugUserState?.record || datatugUserState.record === null,
          );
          const { record } = datatugUserState;
          if (record || record == null) {
            this.stores.set(allUserStoresAsFlatList(record?.datatug?.stores));
          }
        },
        error: this.errorLogger.logErrorHandler(
          'Failed to get datatug user state',
        ),
      });
  }

  ngOnDestroy() {
    this.destroyed.next();
    this.destroyed.complete();
  }

  storeIcon(storeType: DatatugProjStoreType): string {
    switch (storeType) {
      case 'firestore':
        return 'cloud-outline';
      case 'github':
        return 'logo-github';
      default:
        return 'terminal-outline';
    }
  }

  storeDescription(storeType: DatatugProjStoreType): string {
    return (
      this.storageOptions.find((option) => option.type === storeType)
        ?.description || 'Connect projects to your data and query history.'
    );
  }

  goStore(brief: IDatatugStoreBriefWithId): void {
    if (!brief.projects) {
      brief = { ...brief, projects: {} }; // TODO: document why we do this or remove
    }
    const store: IDatatugStoreContext = {
      ref: parseDatatugStoreRef(brief.id),
      brief,
    };
    this.datatugNavService.goStore(store);
  }
}
