import { Component, OnDestroy, inject } from '@angular/core';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  AuthStatus,
  AuthStatuses,
  ISneatAuthState,
  SneatAuthStateService,
} from '@sneat/auth-core';
import { AuthMenuItemComponent } from '@sneat/auth-ui';
import { WormholeModule } from '@sneat/wormhole';
import { IonCard, IonCardContent } from '@ionic/angular/standalone';
import { DatatugCoreModule } from '../core/datatug-core.module';
import { DatatugServicesStoreModule } from '../services/repo/datatug-services-store.module';
import { DatatugServicesProjectModule } from '../services/project/datatug-services-project.module';
import { DatatugServicesNavModule } from '../services/nav/datatug-services-nav.module';
import { DatatugServicesUnsortedModule } from '../services/unsorted/datatug-services-unsorted.module';
import { IEnvDbTableContext, IProjectContext } from '../nav/nav-models';
import {
  DatatugUserService,
  IDatatugUserState,
} from '../services/base/datatug-user-service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { NewProjectService } from '../project/new-project/new-project.service';
import { ProjectMenuComponent } from '../components/project/project-menu/project-menu.component';
import { MenuStoreSelectorComponent } from './menu-store-selector.component';
import { MenuProjectSelectorComponent } from './menu-project-selector.component';
import { MenuEnvSelectorComponent } from './menu-env-selector.component';

@Component({
  selector: 'sneat-datatug-menu',
  templateUrl: './datatug-menu.component.html',
  styleUrls: ['./datatug-menu.component.scss'],
  imports: [
    IonCard,
    IonCardContent,
    AuthMenuItemComponent,
    WormholeModule,
    DatatugCoreModule,
    DatatugServicesStoreModule,
    DatatugServicesProjectModule,
    DatatugServicesNavModule,
    DatatugServicesUnsortedModule,
    MenuStoreSelectorComponent,
    MenuProjectSelectorComponent,
    MenuEnvSelectorComponent,
    ProjectMenuComponent,
  ],
  providers: [
    DatatugUserService,
    NewProjectService,
  ],
})
export class DatatugMenuComponent implements OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly sneatAuthStateService = inject(SneatAuthStateService);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly nav = inject(DatatugNavService);
  private readonly datatugUserService = inject(DatatugUserService);

  public authStatus?: AuthStatus;
  public currentStoreId?: string;
  public currentProject?: IProjectContext;

  public table?: IEnvDbTableContext;
  public currentFolder?: Observable<string | undefined>;
  public authState: ISneatAuthState = { status: AuthStatuses.authenticating };
  private readonly destroyed = new Subject<void>();

  public datatugUserState?: IDatatugUserState;

  constructor() {
    const errorLogger = this.errorLogger;
    const datatugNavContextService = this.datatugNavContextService;

    this.sneatAuthStateService.authState
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (authState) => {
          this.authState = authState;
        },
        error: errorLogger.logErrorHandler(
          'failed to process sneat auth state',
        ),
      });

    try {
      this.trackAuthState();
      this.trackCurrentUser();
      this.currentFolder = datatugNavContextService?.currentFolder;
      if (datatugNavContextService) {
        this.trackCurrentStore();
        this.trackCurrentProject();
        this.trackCurrentEnvDbTable();
      } else {
        console.error('datatugNavContextService is not injected');
      }
    } catch (e) {
      errorLogger.logError(e, 'Failed to setup context tracking');
    }
  }

  private trackAuthState(): void {
    if (!this.sneatAuthStateService) {
      console.error('this.sneatAuthStateService is not injected');
      return;
    }
    this.sneatAuthStateService.authStatus
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (authState) => (this.authStatus = authState),
        error: this.errorLogger.logErrorHandler('failed to get auth stage'),
      });
  }

  ngOnDestroy(): void {
    if (this.destroyed) {
      this.destroyed.next();
      this.destroyed.complete();
    }
  }

  private trackCurrentUser(): void {
    try {
      if (!this.datatugUserService) {
        console.error('this.datatugUserService is not injected');
        return;
      }
      this.datatugUserService.datatugUserState
        .pipe(takeUntil(this.destroyed))
        .subscribe({
          next: (datatugUser) => {
            this.datatugUserState = datatugUser;
          },
          error: this.errorLogger.logErrorHandler(
            'Failed to get user record for menu',
          ),
        });
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to setup tracking of current user');
    }
  }

  private trackCurrentStore(): void {
    try {
      this.datatugNavContextService.currentStoreId
        .pipe(takeUntil(this.destroyed))
        .subscribe({
          next: this.onCurrentStoreChanged,
          error: (err) =>
            this.errorLogger.logError(err, 'Failed to get storeId'),
        });
    } catch (e) {
      this.errorLogger.logError(
        e,
        'Failed to setup tracking of current repository',
      );
    }
  }

  private readonly onCurrentStoreChanged = (storeId?: string): void => {
    if (storeId === this.currentStoreId) {
      return;
    }
    console.log(
      'DatatugMenuComponent => storeId changed:',
      storeId,
      this.currentStoreId,
    );
    this.currentStoreId = storeId;
  };

  private trackCurrentProject(): void {
    try {
      this.datatugNavContextService.currentProject
        .pipe(takeUntil(this.destroyed))
        .subscribe({
          next: this.onProjectChanged,
          error: (err) =>
            this.errorLogger.logError(err, 'Failed to get current project'),
        });
    } catch (e) {
      this.errorLogger.logError(
        e,
        'Failed to setup tracking of current project',
      );
    }
  }

  onProjectChanged = (project?: IProjectContext) => {
    this.currentProject = project;
  };

  private trackCurrentEnvDbTable(): void {
    this.datatugNavContextService.currentEnvDbTable
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (table) => {
          if (table) {
            if (
              table.name !== this.table?.name &&
              table.schema !== this.table?.schema
            ) {
              console.log(
                `DatatugMenuComponent => currentTable changed to: ${table.schema}.${table.name}, meta:`,
                table.meta,
              );
            }
          }
          this.table = table;
        },
        error: (err) =>
          this.errorLogger.logError(err, 'Failed to get current table context'),
      });
  }
}
