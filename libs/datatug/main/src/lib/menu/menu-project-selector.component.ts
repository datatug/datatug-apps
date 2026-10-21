import {
  Component,
  DestroyRef,
  EventEmitter,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IProjectContext, parseDatatugStoreRef } from '../nav/nav-models';
import { NewProjectService } from '../project/new-project/new-project.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import {
  IDatatugProjectBriefWithId,
  IDatatugUser,
  projectsBriefFromDictToFlatList,
} from '../models/interfaces';

@Component({
  selector: 'sneat-datatug-menu-project-selector',
  templateUrl: 'menu-project-selector.component.html',
  styleUrl: 'menu-project-selector.component.scss',
  imports: [
    IonItem,
    IonButtons,
    IonButton,
    IonIcon,
    IonLabel,
    IonSelect,
    IonSelectOption,
  ],
})
export class MenuProjectSelectorComponent implements OnChanges {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly newProjectService = inject(NewProjectService);
  private readonly nav = inject(DatatugNavService);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly destroyRef = inject(DestroyRef);

  readonly datatugUser = input<IDatatugUser>();
  readonly currentStoreId = signal<string | undefined>(undefined);
  readonly currentProjectId = signal<string | undefined>(undefined);
  readonly currentProject = signal<IProjectContext | undefined>(undefined);
  readonly projectLabel = signal('');

  @Output() projectChanged = new EventEmitter<IProjectContext>();

  readonly projects = signal<IDatatugProjectBriefWithId[] | undefined>(
    undefined,
  );

  constructor() {
    const datatugNavContextService = this.datatugNavContextService;

    datatugNavContextService.currentStoreId
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (storeId) => {
          this.currentStoreId.set(storeId);
          this.refreshProjects();
        },
        error: this.errorLogger.logErrorHandler('Failed to retrieve store id'),
      });
    datatugNavContextService.currentProject
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: this.setProject,
        error: this.errorLogger.logErrorHandler(
          'Failed to retrieve project context',
        ),
      });
  }

  private setProject = (project: IProjectContext | undefined): void => {
    this.currentProject.set(project);
    this.currentProjectId.set(project?.ref?.projectId);
    this.projectLabel.set(
      project?.summary?.title ||
        project?.brief?.title ||
        project?.ref?.projectId ||
        '',
    );
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['datatugUser']) {
      this.refreshProjects();
    }
  }

  private refreshProjects(): void {
    const storeId = this.currentStoreId();
    const projectsById = storeId
      ? this.datatugUser()?.datatug?.stores?.[storeId]?.projects
      : undefined;
    this.projects.set(projectsBriefFromDictToFlatList(projectsById));
  }

  public newProject(): void {
    this.newProjectService.navigateToNewProjectPage();
  }

  switchProject(event: CustomEvent): void {
    try {
      const projectId: string = event.detail.value;
      if (!projectId) {
        return;
      }
      const storeId = this.currentStoreId();
      if (!storeId) {
        return;
      }
      const brief = this.projects()?.find((p) => p.id === projectId);
      if (!brief) {
        return;
      }
      const project = {
        ref: { projectId, storeId },
        brief,
        store: { ref: parseDatatugStoreRef(storeId) },
      };
      this.currentProject.set(project);
      this.datatugNavContextService.setCurrentProject(project);
      if (projectId) {
        this.nav.goProject(project);
      }
      this.projectChanged.emit(project);
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to handle project switch');
    }
  }
}
