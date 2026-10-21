import {
  Component,
  DestroyRef,
  EventEmitter,
  OnChanges,
  OnDestroy,
  Output,
  computed,
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
  IonNote,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import {
  ErrorLogger,
  IErrorLogger,
  storeCanProvideListOfProjects,
} from '@sneat/core';
import { IProjectContext, parseDatatugStoreRef } from '../nav/nav-models';
import { IProjectRef } from '../core/project-context';
import { readGithubProjectId } from '@datatug/project-address';
import { NewProjectService } from '../project/new-project/new-project.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { DatatugStoreService } from '../services/repo/datatug-store.service';
import { IProjectBase } from '../models/definition/project';
import { Subscription } from 'rxjs';
import { IDatatugUser, projectsBriefFromDictToFlatList } from '../models/interfaces';

interface ProjectChoice {
  readonly id: string;
  readonly title: string;
  readonly access?: IProjectBase['access'];
  readonly projectApi?: 'cloud' | 'local';
  readonly branch?: string;
  readonly ref: IProjectRef;
}

@Component({
  selector: 'sneat-datatug-menu-project-selector',
  templateUrl: 'menu-project-selector.component.html',
  styleUrls: ['menu-selector.component.scss'],
  imports: [
    IonItem,
    IonButtons,
    IonButton,
    IonIcon,
    IonLabel,
    IonNote,
    IonSelect,
    IonSelectOption,
  ],
})
export class MenuProjectSelectorComponent implements OnChanges, OnDestroy {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly newProjectService = inject(NewProjectService);
  private readonly nav = inject(DatatugNavService);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly storeService = inject(DatatugStoreService);
  private readonly destroyRef = inject(DestroyRef);

  readonly datatugUser = input<IDatatugUser>();
  readonly currentStoreId = signal<string | undefined>(undefined);
  readonly currentProjectId = signal<string | undefined>(undefined);
  readonly currentProject = signal<IProjectContext | undefined>(undefined);

  @Output() projectChanged = new EventEmitter<IProjectContext>();

  readonly projects = signal<ProjectChoice[]>([]);
  readonly selectedProjectTitle = computed(
    () =>
      this.projects().find((project) => project.id === this.currentProjectId())
        ?.title ?? this.currentProjectId(),
  );
  readonly projectListState = signal<'ready' | 'loading' | 'error'>('ready');
  readonly projectSelectInterfaceOptions = {
    cssClass: 'menu-project-options',
  };
  private projectListRequest?: Subscription;
  private projectListRequestId = 0;

  constructor() {
    const datatugNavContextService = this.datatugNavContextService;

    datatugNavContextService.currentStoreId
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (storeId) => {
          this.currentStoreId.set(storeId);
          if (this.currentProject()?.ref.storeId !== storeId) {
            this.currentProjectId.set(undefined);
          }
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
    const changed = this.currentProject() !== project;
    this.currentProject.set(project);
    this.currentProjectId.set(
      project?.ref?.storeId === this.currentStoreId()
        ? project?.ref?.projectId
        : undefined,
    );
    if (changed) this.refreshProjects();
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
    const savedProjects = projectsBriefFromDictToFlatList(projectsById);
    const savedChoices: ProjectChoice[] = savedProjects.map((project) => ({
      ...project,
      ref: {
        projectId: project.id,
        storeId: storeId ?? '',
        ...(project.projectApi
          ? { projectApi: project.projectApi, branch: project.branch }
          : {}),
      },
    }));
    this.projectListRequest?.unsubscribe();
    const requestId = ++this.projectListRequestId;
    this.projects.set(this.mergeCurrentProject(storeId, savedChoices));
    this.projectListState.set('ready');

    if (
      !storeId ||
      !storeCanProvideListOfProjects(storeId)
    ) {
      return;
    }

    this.projectListState.set('loading');
    this.projectListRequest = this.storeService
      .getProjects(storeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (projects) => {
          if (
            requestId !== this.projectListRequestId ||
            storeId !== this.currentStoreId()
          ) {
            return;
          }
          const listedChoices: ProjectChoice[] = projects.map((project) => ({
            ...project,
            ref: { projectId: project.id, storeId },
          }));
          this.projects.set(
            this.mergeCurrentProject(
              storeId,
              this.mergeProjectChoices(savedChoices, listedChoices),
            ),
          );
          this.projectListState.set('ready');
        },
        error: (error: unknown) => {
          if (
            requestId !== this.projectListRequestId ||
            storeId !== this.currentStoreId()
          ) {
            return;
          }
          this.projectListState.set('error');
          this.errorLogger.logError(
            error,
            'Failed to list projects in the selected store',
          );
        },
      });
  }

  private mergeProjectChoices(
    saved: ProjectChoice[],
    listed: ProjectChoice[],
  ): ProjectChoice[] {
    const choices = new Map(saved.map((project) => [project.id, project]));
    for (const project of listed) {
      if (!choices.has(project.id)) choices.set(project.id, project);
    }
    return [...choices.values()];
  }

  private mergeCurrentProject(
    storeId: string | undefined,
    choices: ProjectChoice[],
  ): ProjectChoice[] {
    const project = this.currentProject();
    if (!storeId || !project) return choices;
    const ref = project?.ref;
    if (!ref?.projectId || ref.storeId !== storeId) return choices;
    const current: ProjectChoice = {
      id: ref.projectId,
      title: project.summary?.title || project.brief?.title || ref.projectId,
      ...(project.brief?.access ? { access: project.brief.access } : {}),
      ...(ref.projectApi ? { projectApi: ref.projectApi } : {}),
      ...(ref.branch ? { branch: ref.branch } : {}),
      ref,
    };
    return [current, ...choices.filter((choice) => choice.id !== current.id)];
  }

  hasSavedProjects(): boolean {
    const storeId = this.currentStoreId();
    return !!storeId && !!Object.keys(
      this.datatugUser()?.datatug?.stores?.[storeId]?.projects ?? {},
    ).length;
  }

  projectChoiceDescription(project: ProjectChoice): string {
    if (project.ref.storeId !== 'github.com') return project.id;
    const reading = readGithubProjectId(project.id);
    if (!reading.ok) return project.id;
    return `${reading.id.org}/${reading.id.repo} · ${reading.id.folder}`;
  }

  ngOnDestroy(): void {
    this.projectListRequestId++;
    this.projectListRequest?.unsubscribe();
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
      const current = this.currentProject();
      const { ref: choiceRef, ...projectBrief } = brief;
      const projectRef =
        current?.ref.projectId === projectId && current.ref.storeId === storeId
          ? current.ref
          : choiceRef;
      const project = {
        ...(current?.ref.projectId === projectId &&
        current.ref.storeId === storeId
          ? current
          : {}),
        ref: projectRef,
        brief: projectBrief,
        store:
          current?.ref.projectId === projectId &&
          current.ref.storeId === storeId
            ? current.store
            : { ref: parseDatatugStoreRef(storeId) },
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
