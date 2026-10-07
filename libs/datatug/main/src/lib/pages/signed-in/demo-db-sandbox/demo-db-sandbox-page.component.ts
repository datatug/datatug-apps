import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
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
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { newRandomId } from '@sneat/random';
import { firstValueFrom, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  DatatugUserService,
  IDatatugUserState,
} from '../../../services/base/datatug-user-service';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import {
  DEMO_DB_IDS,
  DemoDbId,
  DemoDbSandboxService,
  SandboxQueryResult,
  SandboxSqlArgument,
  WritableSandboxInfo,
} from './demo-db-sandbox.service';

type SandboxPageState =
  | 'authenticating'
  | 'signed-out'
  | 'anonymous'
  | 'checking'
  | 'not-created'
  | 'ready'
  | 'unavailable'
  | 'error';

@Component({
  selector: 'sneat-datatug-demo-db-sandbox-page',
  standalone: true,
  imports: [
    RouterLink,
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonList,
    IonMenuButton,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button />
          <ion-back-button [defaultHref]="overviewUrl()" />
        </ion-buttons>
        <ion-title>DemoDB sandbox</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content color="light">
      @if (pageState() === 'authenticating') {
        <ion-card
          ><ion-item
            ><ion-spinner slot="start" /><ion-label
              >Checking sign-in…</ion-label
            ></ion-item
          ></ion-card
        >
      } @else if (pageState() === 'signed-out') {
        <ion-card>
          <ion-card-header
            ><ion-card-title
              >Sign in to use a private sandbox</ion-card-title
            ></ion-card-header
          >
          <ion-card-content>
            <p>Your writable clone is private to your registered account.</p>
            <ion-button routerLink="/login">Sign in or register</ion-button>
          </ion-card-content>
        </ion-card>
      } @else if (pageState() === 'anonymous') {
        <ion-card>
          <ion-card-header
            ><ion-card-title
              >Register to use a private sandbox</ion-card-title
            ></ion-card-header
          >
          <ion-card-content>
            <p>
              You are signed in anonymously. Create or sign in to a registered
              account to get a writable clone.
            </p>
            <ion-button routerLink="/login">Sign in or register</ion-button>
          </ion-card-content>
        </ion-card>
      } @else {
        <ion-card>
          <ion-card-header
            ><ion-card-title
              >Your writable DemoDB clone</ion-card-title
            ></ion-card-header
          >
          <ion-card-content>
            <p>
              Each account gets one isolated branch containing all six sample
              databases. Changes are private to your account.
            </p>
            <p>
              Inactive sandboxes are deleted after 7 days. Compute is limited to
              0.25 CU per account and suspends automatically while idle.
            </p>
            <p>
              Each database starts from the published sample. The maximum
              aggregate branch size is the sample size plus 10%. A best-effort
              gateway check applies this threshold; it is not a provider-level
              hard quota.
            </p>
            @if (pageState() === 'checking') {
              <ion-spinner aria-label="Checking sandbox" />
            } @else if (pageState() === 'not-created') {
              <p>No writable clone exists for this account yet.</p>
              <ion-button
                [disabled]="busy() !== undefined"
                (click)="createSandbox()"
              >
                @if (busy() === 'create') {
                  <ion-spinner slot="start" />
                }
                Create my sandbox
              </ion-button>
            } @else if (pageState() === 'unavailable') {
              <p role="status">
                Sandbox setup is not available right now. Try again later.
              </p>
              <ion-button
                fill="outline"
                [disabled]="busy() !== undefined"
                (click)="refresh()"
                >Check again</ion-button
              >
            } @else if (pageState() === 'error') {
              <p role="alert">{{ message() }}</p>
              <ion-button
                fill="outline"
                [disabled]="busy() !== undefined"
                (click)="refresh()"
                >Retry</ion-button
              >
            }
          </ion-card-content>
        </ion-card>

        @if (pageState() === 'ready' && sandbox(); as info) {
          <ion-card>
            <ion-card-header
              ><ion-card-title>Sandbox status</ion-card-title></ion-card-header
            >
            <ion-list>
              <ion-item
                ><ion-label
                  >Databases
                  <p>{{ info.databases.join(', ') }}</p></ion-label
                ></ion-item
              >
              <ion-item
                ><ion-label
                  >Created
                  <p>{{ formatDate(info.createdAt) }}</p></ion-label
                ></ion-item
              >
              <ion-item
                ><ion-label
                  >Last activity
                  <p>{{ formatDate(info.lastActivityAt) }}</p></ion-label
                ></ion-item
              >
              <ion-item
                ><ion-label
                  >Expires after inactivity
                  <p>{{ formatDate(info.idleExpiresAt) }}</p></ion-label
                ></ion-item
              >
              <ion-item
                ><ion-label
                  >Published sample size
                  <p>{{ formatBytes(info.sampleDatabaseBytes) }}</p></ion-label
                ></ion-item
              >
              <ion-item
                ><ion-label
                  >Maximum aggregate branch size
                  <p>
                    {{ formatBytes(info.sampleGrowthLimitBytes) }}
                  </p></ion-label
                ></ion-item
              >
              <ion-item
                ><ion-label
                  >Last measured branch size
                  <p>{{ formatBytes(info.branchLogicalBytes) }}</p></ion-label
                ></ion-item
              >
            </ion-list>
            <ion-card-content>
              <ion-button
                fill="outline"
                [disabled]="busy() !== undefined"
                (click)="refresh()"
                >Refresh status</ion-button
              >
              <ion-button
                color="danger"
                fill="outline"
                [disabled]="busy() !== undefined"
                (click)="deleteSandbox()"
              >
                @if (busy() === 'delete') {
                  <ion-spinner slot="start" />
                }
                Delete my sandbox
              </ion-button>
              @if (confirmingDelete()) {
                <ion-item role="alert">
                  <ion-label
                    >Delete this private clone and all changes
                    permanently?</ion-label
                  >
                  <ion-button color="danger" (click)="confirmDelete()"
                    >Confirm delete</ion-button
                  >
                  <ion-button fill="clear" (click)="cancelDelete()"
                    >Cancel</ion-button
                  >
                </ion-item>
              }
            </ion-card-content>
          </ion-card>

          <ion-card>
            <ion-card-header
              ><ion-card-title>Run SQL</ion-card-title></ion-card-header
            >
            <ion-card-content>
              <p>
                One statement per request, up to 10 seconds, 1,000 rows and 1
                MiB. SELECT, INSERT, UPDATE and DELETE are supported.
              </p>
              <p>
                Pass exact decimals as JSON strings and cast in SQL, for example
                <code>$1::numeric</code>.
              </p>
              <ion-item>
                <ion-label>Database</ion-label>
                <ion-select
                  [value]="database()"
                  (ionChange)="database.set($event.detail.value)"
                >
                  @for (id of databaseIds; track id) {
                    <ion-select-option [value]="id">{{ id }}</ion-select-option>
                  }
                </ion-select>
              </ion-item>
              <ion-item>
                <ion-label position="stacked">SQL</ion-label>
                <ion-textarea
                  [value]="sql()"
                  (ionInput)="sql.set($event.detail.value ?? '')"
                  [autoGrow]="true"
                  rows="6"
                />
              </ion-item>
              <ion-item>
                <ion-label position="stacked">Arguments (JSON array)</ion-label>
                <ion-textarea
                  [value]="argsText()"
                  (ionInput)="argsText.set($event.detail.value ?? '')"
                  rows="2"
                />
              </ion-item>
              @if (message()) {
                <p role="alert">{{ message() }}</p>
              }
              <ion-button
                [disabled]="busy() !== undefined || pageState() !== 'ready'"
                (click)="runQuery()"
              >
                @if (busy() === 'query') {
                  <ion-spinner slot="start" />
                }
                Run query
              </ion-button>
              @if (queryResult(); as result) {
                <p>{{ result.command }} · {{ result.rows.length }} row(s)</p>
                <div
                  class="sandbox-results"
                  role="region"
                  aria-label="Query results"
                >
                  <table>
                    <thead>
                      <tr>
                        @for (column of result.columns; track $index) {
                          <th>{{ column.name }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of result.rows; track $index) {
                        <tr>
                          @for (
                            column of result.columns;
                            let index = $index;
                            track $index
                          ) {
                            <td>{{ formatCell(row[index]) }}</td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </ion-card-content>
          </ion-card>
        }
      }
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoDbSandboxPageComponent implements OnDestroy {
  private readonly userService = inject(DatatugUserService);
  private readonly sandboxService = inject(DemoDbSandboxService);
  private readonly navContext = inject(DatatugNavContextService);
  private readonly nav = inject(DatatugNavService);
  private readonly destroyed = new Subject<void>();
  private lastUid: string | undefined;
  private pendingCreateRequestId: string | undefined;
  private operationId = 0;

  protected readonly pageState = signal<SandboxPageState>('authenticating');
  protected readonly sandbox = signal<WritableSandboxInfo | undefined>(
    undefined,
  );
  protected readonly message = signal<string | undefined>(undefined);
  protected readonly busy = signal<
    'status' | 'create' | 'delete' | 'query' | undefined
  >(undefined);
  protected readonly queryResult = signal<SandboxQueryResult | undefined>(
    undefined,
  );
  protected readonly confirmingDelete = signal(false);
  protected readonly databaseIds = DEMO_DB_IDS;
  protected readonly database = signal<DemoDbId>('chinook');
  protected readonly sql = signal('SELECT 1 AS sandbox_is_ready;');
  protected readonly argsText = signal('[]');
  protected readonly overviewUrl = signal('/');

  constructor() {
    this.navContext.currentProject
      .pipe(takeUntil(this.destroyed))
      .subscribe((project) => {
        this.overviewUrl.set(
          project ? this.nav.projectPageUrl(project.ref, 'overview') : '/',
        );
      });
    this.userService.datatugUserState
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (state) => this.onUserState(state),
        error: () => {
          this.pageState.set('error');
          this.message.set(
            'Sign-in status could not be checked. Reload the page and try again.',
          );
        },
      });
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  private onUserState(state: IDatatugUserState): void {
    const uid = state.user?.uid;
    const anonymous =
      state.status === 'authenticated' && state.user?.isAnonymous === true;
    if (state.status !== 'authenticated' || !uid || anonymous) {
      if (this.lastUid) {
        this.operationId++;
        this.busy.set(undefined);
      }
      this.lastUid = undefined;
      this.sandbox.set(undefined);
      this.queryResult.set(undefined);
      this.confirmingDelete.set(false);
      this.pendingCreateRequestId = undefined;
      this.message.set(undefined);
      this.pageState.set(
        anonymous
          ? 'anonymous'
          : state.status === 'notAuthenticated'
            ? 'signed-out'
            : 'authenticating',
      );
      return;
    }
    if (uid !== this.lastUid) {
      this.operationId++;
      this.busy.set(undefined);
      this.lastUid = uid;
      this.sandbox.set(undefined);
      this.queryResult.set(undefined);
      this.confirmingDelete.set(false);
      this.pendingCreateRequestId = undefined;
      void this.refresh();
    }
  }

  protected async refresh(): Promise<void> {
    if (this.pageState() === 'signed-out' || this.busy() !== undefined) return;
    const operationId = ++this.operationId;
    this.busy.set('status');
    this.pageState.set('checking');
    this.message.set(undefined);
    try {
      const info = await firstValueFrom(this.sandboxService.get());
      if (operationId !== this.operationId) return;
      this.sandbox.set(info);
      this.pageState.set('ready');
    } catch (error) {
      if (operationId !== this.operationId) return;
      this.applyApiError(error, 'status');
    } finally {
      if (operationId === this.operationId) this.busy.set(undefined);
    }
  }

  protected async createSandbox(): Promise<void> {
    if (this.pageState() !== 'not-created' || this.busy() !== undefined) return;
    const operationId = ++this.operationId;
    this.pendingCreateRequestId ??= newRandomId({ len: 24 });
    this.busy.set('create');
    this.message.set(undefined);
    try {
      const info = await firstValueFrom(
        this.sandboxService.create(this.pendingCreateRequestId),
      );
      if (operationId !== this.operationId) return;
      this.pendingCreateRequestId = undefined;
      this.sandbox.set(info);
      this.pageState.set('ready');
    } catch (error) {
      if (operationId !== this.operationId) return;
      this.applyApiError(error, 'create');
    } finally {
      if (operationId === this.operationId) this.busy.set(undefined);
    }
  }

  protected async deleteSandbox(): Promise<void> {
    if (this.pageState() !== 'ready' || this.busy() !== undefined) return;
    this.confirmingDelete.set(true);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  protected async confirmDelete(): Promise<void> {
    if (
      !this.confirmingDelete() ||
      this.pageState() !== 'ready' ||
      this.busy() !== undefined
    )
      return;
    const operationId = ++this.operationId;
    this.confirmingDelete.set(false);
    this.busy.set('delete');
    this.message.set(undefined);
    try {
      await firstValueFrom(this.sandboxService.delete());
      if (operationId !== this.operationId) return;
      this.sandbox.set(undefined);
      this.queryResult.set(undefined);
      this.pageState.set('not-created');
    } catch (error) {
      if (operationId !== this.operationId) return;
      this.applyApiError(error, 'delete');
    } finally {
      if (operationId === this.operationId) this.busy.set(undefined);
    }
  }

  protected async runQuery(): Promise<void> {
    if (this.pageState() !== 'ready' || this.busy() !== undefined) return;
    let args: unknown;
    try {
      args = JSON.parse(this.argsText());
    } catch {
      this.message.set('Arguments must be a valid JSON array.');
      return;
    }
    if (!Array.isArray(args) || !args.every(isSandboxSqlArgument)) {
      this.message.set(
        'Arguments must be a JSON array of strings, numbers, booleans or null.',
      );
      return;
    }
    const sql = this.sql().trim();
    if (!sql) {
      this.message.set('Enter one SQL statement to run.');
      return;
    }
    this.busy.set('query');
    const operationId = ++this.operationId;
    this.message.set(undefined);
    try {
      const result = await firstValueFrom(
        this.sandboxService.query({
          database: this.database(),
          sql,
          args: args as SandboxSqlArgument[],
        }),
      );
      if (operationId !== this.operationId) return;
      this.queryResult.set(result);
      // The gateway response contains query output only. Refresh the server's
      // authoritative activity and size values instead of guessing with the
      // browser clock.
      try {
        const info = await firstValueFrom(this.sandboxService.get());
        if (operationId === this.operationId) this.sandbox.set(info);
      } catch {
        // Keep the successful query result and the last known status if a
        // separate status refresh fails.
      }
    } catch (error) {
      if (operationId !== this.operationId) return;
      this.applyApiError(error, 'query');
    } finally {
      if (operationId === this.operationId) this.busy.set(undefined);
    }
  }

  protected formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let value = bytes;
    let unit = -1;
    do {
      value /= 1024;
      unit++;
    } while (value >= 1024 && unit < units.length - 1);
    return `${value.toFixed(1)} ${units[unit]}`;
  }

  protected formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
  }

  protected formatCell(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private applyApiError(
    error: unknown,
    action: 'status' | 'create' | 'delete' | 'query',
  ): void {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (action === 'status' && status === 404) {
      this.sandbox.set(undefined);
      this.pageState.set('not-created');
      this.message.set(undefined);
      return;
    }
    if (status === 503) {
      this.pageState.set('unavailable');
      this.message.set(undefined);
      return;
    }
    if (action === 'create' && status === 409) {
      this.pageState.set('error');
      this.message.set(
        'A sandbox operation is already in progress for this account. Refresh status before retrying.',
      );
      return;
    }
    if (status === 401 || status === 403) {
      this.pageState.set('error');
      this.message.set(
        'Your sign-in could not be verified for this sandbox. Sign in again and retry.',
      );
      return;
    }
    if (action === 'query') {
      this.message.set(
        status === 400
          ? 'The SQL or arguments were rejected, or the branch growth allowance was reached. Check the query limits and try again.'
          : 'The query could not be completed. Check the SQL and sandbox limits, then try again.',
      );
      return;
    }
    this.pageState.set('error');
    this.message.set(
      'The sandbox request failed. Check your connection and retry.',
    );
  }
}

function isSandboxSqlArgument(value: unknown): value is SandboxSqlArgument {
  return (
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  );
}
