import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  inject,
  input,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
} from '@ionic/angular';
import {
  allUserProjectsAsFlatList,
  IDatatugProjectBriefWithIdAndStoreRef,
  IProjectAndStore,
} from '../../../models/interfaces';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import {
  DatatugUserService,
  IDatatugUserState,
} from '../../../services/base/datatug-user-service';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { ISneatAuthState, SneatAuthStateService } from '@sneat/auth-core';
import { STORE_TYPE_GITHUB } from '@sneat/core';
import { NewProjectService } from '../../../project/new-project/new-project.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DEMO_PROJECT_REF } from '../../../nav/github-project-address';
import { IProjectContext } from '../../../nav/nav-models';
import { LoadingItemsComponent } from '../loading-items-component';

interface DemoProjectOption {
  readonly project: IDatatugProjectBriefWithIdAndStoreRef;
  readonly provider: string;
  readonly summary: string;
  readonly highlights: readonly string[];
}

@Component({
  selector: 'sneat-datatug-my-projects',
  templateUrl: './my-datatug-projects.component.html',
  styleUrl: './my-datatug-projects.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LoadingItemsComponent,
    IonCard,
    IonCardContent,
    IonItem,
    IonLabel,
    IonButtons,
    IonButton,
    IonIcon,
    IonItemDivider,
    IonList,
  ],
})
export class MyDatatugProjectsComponent implements OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly navService = inject(DatatugNavService);
  private readonly sneatAuthStateService = inject(SneatAuthStateService);
  private readonly datatugUserService = inject(DatatugUserService);
  private readonly newProjectService = inject(NewProjectService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly title = input<string>();

  public datatugUserState?: IDatatugUserState;
  public userRecordLoaded = false;

  public authState?: ISneatAuthState;

  private readonly destroyed = new Subject<void>();
  public projects?: IProjectAndStore[];
  // The shared demo lives in datatug/datatug-demo-project/demo-project-1.
  // Its nested project id and address come from DEMO_PROJECT_REF.
  public demoProjects: IDatatugProjectBriefWithIdAndStoreRef[] = [
    {
      id: DEMO_PROJECT_REF.projectId,
      access: 'public',
      store: { ref: { type: STORE_TYPE_GITHUB, id: 'github.com' } },
      title: 'DataTug public demo',
    },
  ];

  // Add another option here when a real hosted demo is ready. Each slot owns
  // its provider label, honest capabilities, and the existing project target.
  public readonly demoOptions: readonly DemoProjectOption[] = [
    {
      project: this.demoProjects[0],
      provider: 'GitHub',
      summary:
        'Explore the project structure and inspect three saved Chinook SQL examples.',
      highlights: [
        'Browse project files and data context',
        'See how the saved Chinook queries are organized',
      ],
    },
  ];

  public showDemoProjects = true;

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  constructor() {
    // OnPush + markForCheck: state is driven by an observable, so the component
    // is only re-checked when its own data emits (not when an unrelated change
    // detection pass — e.g. the lazy menu activating — runs), which avoids
    // ExpressionChangedAfterItHasBeenChecked (NG0100).
    this.datatugUserService.datatugUserState
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (datatugUserState) => {
          this.authState = datatugUserState;
          this.userRecordLoaded =
            !!datatugUserState?.record || datatugUserState.record === null;
          const { record } = datatugUserState;
          if (record || record == null) {
            this.projects = allUserProjectsAsFlatList(record?.datatug?.stores);
          }
          this.changeDetectorRef.markForCheck();
        },
        error: this.errorLogger.logErrorHandler(
          'Failed to get datatug user state',
        ),
      });
  }

  goDemoProject(project: IDatatugProjectBriefWithIdAndStoreRef): void {
    const projectContext: IProjectContext = {
      ref: { projectId: project.id, storeId: project.store.ref.type },
      brief: project,
      store: project.store,
    };
    this.navService.goProject(projectContext);
  }

  goProject(project: IProjectAndStore): void {
    const projectContext: IProjectContext = {
      ref: project.ref,
      brief: project.project,
      store: { ref: project.store, brief: project.store },
    };
    this.navService.goProject(projectContext);
  }

  addProject(): void {
    this.newProjectService.navigateToNewProjectPage();
  }
}
