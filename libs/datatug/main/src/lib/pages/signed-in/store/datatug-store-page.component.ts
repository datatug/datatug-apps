import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonMenuButton,
  IonTitle,
  IonToolbar,
  ViewDidEnter,
  ViewDidLeave,
} from '@ionic/angular';
import { AuthStatus } from '@sneat/auth-core';
import { SneatErrorCardComponent } from '@sneat/components';
import {
  ErrorLogger,
  IErrorLogger,
  IStoreRef,
  STORE_ID_GITHUB_COM,
  STORE_TYPE_GITHUB,
} from '@sneat/core';
import { merge, Subject } from 'rxjs';
import { filter, takeUntil, tap } from 'rxjs/operators';
import { IProjectBase } from '../../../models/definition/project';
import { projectsBriefFromDictToFlatList } from '../../../models/interfaces';
import {
  IDatatugStoreContext,
  IProjectContext,
  parseDatatugStoreRef,
  storeIdToDisplayLabel,
} from '../../../nav/nav-models';
import { NewProjectService } from '../../../project/new-project/new-project.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';
import { StoreTracker } from '../../../services/nav/contexts/store.tracker';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import {
  AgentStateService,
  IAgentState,
} from '../../../services/repo/agent-state.service';
import { DatatugStoreService } from '../../../services/repo/datatug-store.service';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';

/**
 * True for either canonical form of the GitHub store id this app ends up
 * with: `'github.com'` (`STORE_ID_GITHUB_COM` — the id `allUserStoresAsFlatList()`
 * and the home page's "My projects" demo entry both use) or the bare
 * `'github'` (`STORE_TYPE_GITHUB` — what the URL actually carries after the
 * home page's "Project stores" card navigates: `MyStoresComponent.goStore()`
 * builds the route from `storeRefToId(parseDatatugStoreRef(brief.id))`, and
 * `@sneat/core`'s `parseStoreRef('github.com')` returns `{ type: 'github' }`
 * with no `.id`/`.url`, so the round trip loses the `.com` suffix before this
 * component ever sees it — see `resolveStateStoreId()` below for the same
 * issue on the router-state path. Fixing that id round trip needs a change in
 * either `@sneat/core` or `MyStoresComponent`/`DatatugNavService`, both
 * outside this file's scope (see the S137 report) — treating both forms as
 * "the GitHub store" here is the workaround that keeps this page correct
 * regardless of which one actually shows up in the URL.
 */
function isGithubStoreId(storeId: string | null | undefined): boolean {
  return storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;
}

/**
 * The one GitHub project every fresh install can open without first
 * connecting a real repository. Deliberately kept in sync BY HAND with
 * `pages/home/my-projects/my-datatug-projects.component.ts`'s own
 * `demoProjects` field: that field isn't exported (it's a plain component
 * instance property), and this stream's scope is this `store/` folder only
 * — it does not extend to editing that lane's component to export a shared
 * constant. See the S137 report for the follow-up this leaves open.
 */
export const GITHUB_DEMO_PROJECTS: IProjectBase[] = [
  {
    id: 'datatug-demo-projects@datatug@demo-project-1',
    title: 'DataTug Demo Project @ GitHub',
    access: 'public',
  },
];

/**
 * Adds this app's known GitHub demo project(s) to `projects` when `storeId`
 * is the GitHub store (either id form — see `isGithubStoreId()`), de-duped
 * by id; returns `projects` unchanged for every other store so `firestore`
 * and agent stores keep their existing behaviour.
 */
function withGithubDemoProjects(
  storeId: string | null | undefined,
  projects: IProjectBase[],
): IProjectBase[] {
  if (!isGithubStoreId(storeId)) {
    return projects;
  }
  const merged = [...projects];
  for (const demo of GITHUB_DEMO_PROJECTS) {
    if (!merged.some((p) => p.id === demo.id)) {
      merged.push(demo);
    }
  }
  return merged;
}

/**
 * Derives the storeId to seed `this.storeId`/`this.projects` with from a
 * store passed via router state (`window.history.state.store`), for a
 * non-agent store. `IDatatugStoreContext` has no top-level `.id` (only
 * `.ref: IStoreRef` and `.brief`), and `.ref.id` is frequently missing too —
 * `MyStoresComponent.goStore()` builds `.ref` via `parseDatatugStoreRef()`,
 * which for anything but a bare `host:port` id delegates to `@sneat/core`'s
 * `parseStoreRef()`, and that never round-trips `.id`/`.url` back onto the
 * ref it returns (see `isGithubStoreId()`'s comment above). So: prefer an
 * explicit `.id` when one is present (the home page's "My projects" demo
 * entry sets `ref: { type: STORE_TYPE_GITHUB, id: 'github.com' }` directly),
 * fall back to the canonical GitHub id for a GitHub ref with no `.id`, else
 * fall back to `.url` or the bare `.type`.
 */
function resolveStateStoreId(ref: IStoreRef): string {
  if (ref.id) {
    return ref.id;
  }
  if (ref.type === STORE_TYPE_GITHUB) {
    return STORE_ID_GITHUB_COM;
  }
  return ref.url || ref.type;
}

@Component({
  selector: 'sneat-datatug-store-page',
  templateUrl: './datatug-store-page.component.html',
  imports: [
    // `DatatugStoreService`/`AgentStateService` (both injected below) are
    // provided by this module, not `providedIn: 'root'`. Every route that
    // reaches this component directly (`/store/:storeId` itself, or a
    // hard `page.goto('/store/...')`) previously threw `NG0201: No
    // provider found for _DatatugStoreService` — no ancestor route
    // provides it either (see `routes/datatug-routing.module.ts` and
    // `routes/datatug-routing-store.ts`, neither has a `providers:`
    // entry for it). It went unnoticed because the only e2e that reached
    // this component tree navigated straight to the child project page
    // instead (`ProjectPageComponent`, which already imports this same
    // module) — see `journey.spec.ts`'s J1 comment. Found while adding
    // `e2e/journey/store-id-scheme.spec.ts` for this stream, which DOES
    // navigate straight to this page.
    DatatugServicesStoreModule,
    SneatErrorCardComponent,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonList,
    IonItemDivider,
    IonLabel,
    IonButton,
    IonIcon,
    IonItem,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonInput,
  ],
  // NewProjectService (injected below) has no `providedIn: 'root'`, and —
  // unlike `DatatugServicesStoreModule` above — no ancestor route provides
  // it: `/store/:storeId` is a sibling top-level route
  // (`routes/datatug-routing.module.ts`), not a child of `/`, so it never
  // inherits `DatatugHomePageComponent`'s own local provider. This threw the
  // same NG0201 as the `DatatugServicesStoreModule` gap above for any direct
  // hit on `/store/:storeId` (a full navigation, or a `page.goto`),
  // independent of this stream's store-id fix. (DatatugUserService used to
  // be provided here too, for the same reason — it is now `providedIn:
  // 'root'` instead; see its own file.)
  providers: [NewProjectService],
})
export class DatatugStorePageComponent
  implements OnInit, OnDestroy, ViewDidLeave, ViewDidEnter
{
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly route = inject(ActivatedRoute);
  private readonly storeService = inject(DatatugStoreService);
  private readonly nav = inject(DatatugNavService);
  private readonly agentStateService = inject(AgentStateService);
  private readonly newProjectService = inject(NewProjectService);
  private readonly datatugUserService = inject(DatatugUserService);

  public storeId?: string | null;
  public projects?: IProjectBase[];
  public error: unknown;

  /**
   * The page title shows this instead of the raw `storeId` so an agent
   * store — reached via `datatug serve`'s `http-<host>:<port>` link —
   * reads as the actual URL (`http://localhost:8989`) the browser calls,
   * not the raw id. A getter, not a stored field: it is purely derived
   * from `storeId` and re-evaluated on every template read, so it never
   * needs its own change-detection trigger — see `storeIdToDisplayLabel()`
   * in `nav-models.ts`.
   */
  public get storeDisplayId(): string {
    return storeIdToDisplayLabel(this.storeId);
  }

  public agentState?: IAgentState;
  public isLoading?: boolean;

  /** True while `storeId` is the GitHub store, in either id form it can
   * arrive in — see `isGithubStoreId()`'s doc comment above. Drives the
   * read-only "Add" note and the "Open a GitHub project" form in the
   * template. */
  public get isGithubStore(): boolean {
    return isGithubStoreId(this.storeId);
  }

  /** "Open a GitHub project" form state — new state, so signals per this
   * repo's zoneless-ready convention (see `AGENTS.md`), even though the
   * surrounding pre-existing fields on this component are plain properties. */
  public readonly githubOwner = signal('datatug');
  public readonly githubRepository = signal('datatug-demo-projects');
  public readonly githubFolder = signal('demo-project-1');
  public readonly githubFormError = signal<string | undefined>(undefined);

  private static readonly GITHUB_ID_SEGMENT_PATTERN =
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

  private readonly destroyed = new Subject<void>();
  private readonly viewDidLeave = new Subject<void>();
  private readonly storeChanged = new Subject<void>();

  private readonly storeTracker: StoreTracker;

  protected authStatus?: AuthStatus;

  /**
   * The status the template's `@switch` gates the project list/"Open a
   * GitHub project" form on (`datatug-store-page.component.html`). GitHub
   * is a public, read-only store — founder ruling 2026-09-11: its known
   * projects (the demo project, merged in by `withGithubDemoProjects()`)
   * and the "Open a GitHub project" form must render for anonymous
   * visitors, not sit behind "Please sign in to see projects". So this
   * always resolves to `'authenticated'` for the GitHub store regardless
   * of the visitor's real DataTug sign-in state; `firestore` (DataTug
   * Cloud) and agent stores are unchanged — they still gate on the real
   * `authStatus`.
   */
  protected get projectsAuthStatus(): AuthStatus | undefined {
    return this.isGithubStore ? 'authenticated' : this.authStatus;
  }

  constructor() {
    const route = this.route;
    const datatugUserService = this.datatugUserService;
    console.log(
      'DatatugStorePageComponent.constructor(), window.history.state:',
      window.history.state,
    );
    const store = window.history.state?.store as
      | IDatatugStoreContext
      | undefined;
    // Only a non-agent store (firestore, github, ...) gets seeded from router
    // state here. An agent store's project list has to come from the live
    // agent (`processStoreId()`'s agent branch below, unchanged), so a state
    // payload for one carries nothing this page can use yet — falling
    // through to the normal `storeTracker`-driven flow (exactly as if no
    // state had been passed) is correct, not a gap.
    if (store && store.ref?.type !== 'agent') {
      const storeId = resolveStateStoreId(store.ref);
      this.storeId = storeId;
      this.projects = withGithubDemoProjects(
        storeId,
        // `projectsBriefFromDictToFlatList()` returns `IDatatugProjectBriefWithId[]`
        // (`access` optional); `DatatugStoreService.getProjects()` casts the
        // same way for the same reason — see its own "dirty hack" comment.
        projectsBriefFromDictToFlatList(store.brief?.projects) as IProjectBase[],
      );
    }
    this.storeTracker = new StoreTracker(this.destroyed, route);
    datatugUserService.datatugUserState.subscribe((state) => {
      this.authStatus = state.status;
    });
  }

  ionViewDidLeave(): void {
    this.viewDidLeave.next();
  }

  ionViewDidEnter(): void {
    if (this.storeId) {
      this.processStoreId(this.storeId);
    }
  }

  ngOnInit() {
    this.trackStoreId();
  }

  private trackStoreId(): void {
    this.storeTracker.storeId
      .pipe(
        tap(() => this.storeChanged.next()),
        filter((id) => !!id),
      )
      .subscribe({
        next: this.processStoreId,
        error: this.errorLogger.logErrorHandler('Failed to track store id'),
      });
  }

  processStoreId = (storeId: string | null): void => {
    if (storeId === this.storeId) {
      return;
    }
    this.storeId = storeId;
    if (storeId === 'firestore' || isGithubStoreId(storeId)) {
      // Always load with the canonical `'github.com'` id, even when the
      // active route segment is the bare `'github'` (see `isGithubStoreId()`'s
      // doc comment) — `DatatugStoreService.getProjects()`'s own non-agent
      // check (`storeCanProvideListOfProjects()`, `@sneat/core`) only
      // recognises `'github.com'`; passing the bare form through would make
      // it treat this as an agent id and attempt a live HTTP fetch instead.
      this.loadProjects(
        isGithubStoreId(storeId) ? STORE_ID_GITHUB_COM : (storeId as string),
      );
      return;
    }
    if (storeId) {
      this.agentStateService
        .watchAgentInfo(storeId)
        .pipe(
          // `merge()` takes its notifiers as separate arguments, not one
          // array argument — `merge([a, b, c])` instead converts that array
          // itself into a *single* synchronous notifier (via `from()`) that
          // emits all three Subjects as values and completes immediately,
          // so `takeUntil` unsubscribes before `watchAgentInfo`'s `interval`
          // source is ever subscribed to and its first HTTP request never
          // fires. Root cause of e2e/journey/store-id-scheme.spec.ts's
          // "no request observed within 15s" failure (lane S79); reproduced
          // in isolation against this repo's own rxjs before this fix.
          takeUntil(
            merge(this.viewDidLeave, this.destroyed, this.storeChanged),
          ),
        )
        .subscribe({
          next: (agentState) => {
            this.agentState = agentState;
            if (!agentState?.isNotAvailable && !this.projects) {
              this.loadProjects(storeId);
            }
          },
          error: this.errorLogger.logErrorHandler(
            'Failed to get agent state info',
          ),
        });
    }
  };

  private loadProjects(storeId: string): void {
    this.isLoading = true;
    this.storeService
      .getProjects(storeId)
      .pipe(takeUntil(this.storeChanged), takeUntil(this.destroyed))
      .subscribe({
        next: (projects) => this.processStoreProjects(projects),
        error: (err) => {
          this.isLoading = false;
          if (
            err.name === 'HttpErrorResponse' &&
            err.ok === false &&
            err.status === 0
          ) {
            if (!this.agentState?.isNotAvailable) {
              this.agentState = {
                isNotAvailable: true,
                lastCheckedAt: new Date(),
                error: err,
              };
            }
            // this.error = 'Agent is not available at URL: ' + err.url;
          } else {
            this.error = this.errorLogger.logError(
              err,
              `Failed to get list of projects hosted by agent [${storeId}]`,
              { show: false },
            );
          }
        },
      });
  }

  private processStoreProjects(projects: IProjectBase[]): void {
    console.table(projects);
    this.isLoading = false;
    this.projects = withGithubDemoProjects(this.storeId, projects);
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  public goProject(project: IProjectBase, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.storeId) {
      return;
    }
    const projectContext: IProjectContext = {
      ref: { projectId: project.id, storeId: this.storeId },
      store: { ref: parseDatatugStoreRef(this.storeId) },
      brief: {
        access: project.access,
        title: project.title,
      },
    };
    this.nav.goProject(projectContext);
  }

  create(): void {
    this.newProjectService.openNewProjectDialog();
  }

  /** Bound to the "Open a GitHub project" form's owner/repository/folder
   * inputs via `(ionInput)` — not `(ionChange)`, which only fires on blur:
   * with a one-way `[value]="githubOwner()"` binding, any Angular change
   * detection cycle that runs while the user is still typing (zone.js is
   * still active app-wide, so practically any event anywhere can trigger
   * one) re-asserts the last-committed signal value into the input,
   * discarding whatever was typed since. `(ionInput)` fires on every
   * keystroke, so the signal — and the `[value]` it drives — never falls
   * behind what's on screen. Also clears any previous validation error so
   * it doesn't linger after the user starts correcting a field. */
  updateGithubField(
    field: 'owner' | 'repository' | 'folder',
    value: string | null | undefined,
  ): void {
    const v = value ?? '';
    switch (field) {
      case 'owner':
        this.githubOwner.set(v);
        break;
      case 'repository':
        this.githubRepository.set(v);
        break;
      case 'folder':
        this.githubFolder.set(v);
        break;
    }
    this.githubFormError.set(undefined);
  }

  /** Builds the `<repository>@<owner>@<folder>` project id from the form's
   * owner/repository/folder fields and navigates to that project's page —
   * the same `<repo>@<org>@<folder>` scheme the demo project id already
   * uses (`DatatugStoreGithubService.getProjectSummary()`, out of this
   * file's scope, is what turns that id into a raw-content GitHub URL). */
  openGithubProject(event: Event): void {
    event.preventDefault();
    const owner = this.githubOwner().trim();
    const repository = this.githubRepository().trim();
    const folder = this.githubFolder().trim();
    const segments = { owner, repository, folder };
    const invalidField = (
      Object.keys(segments) as Array<keyof typeof segments>
    ).find(
      (key) =>
        !DatatugStorePageComponent.GITHUB_ID_SEGMENT_PATTERN.test(
          segments[key],
        ),
    );
    if (invalidField) {
      this.githubFormError.set(
        `${invalidField[0].toUpperCase()}${invalidField.slice(1)} is required and can only contain letters, digits, ".", "_" or "-" (no "@", "/", or spaces).`,
      );
      return;
    }
    this.githubFormError.set(undefined);
    const projectId = `${repository}@${owner}@${folder}`;
    const storeId = this.storeId || STORE_ID_GITHUB_COM;
    const projectContext: IProjectContext = {
      ref: { projectId, storeId },
      store: { ref: parseDatatugStoreRef(storeId) },
      brief: { access: 'public', title: projectId },
    };
    this.nav.goProject(projectContext);
  }
}
