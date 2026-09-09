import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { IonButton } from '@ionic/angular/ion-button';
import { IonCard } from '@ionic/angular/ion-card';
import { IonCardContent } from '@ionic/angular/ion-card-content';
import { IonCardHeader } from '@ionic/angular/ion-card-header';
import { IonCardTitle } from '@ionic/angular/ion-card-title';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonInput } from '@ionic/angular/ion-input';
import { IonItem } from '@ionic/angular/ion-item';
import { IonList } from '@ionic/angular/ion-list';
import { IonSelect } from '@ionic/angular/ion-select';
import { IonSelectOption } from '@ionic/angular/ion-select-option';
import { IonSpinner } from '@ionic/angular/ion-spinner';
import { IonTextarea } from '@ionic/angular/ion-textarea';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { firstValueFrom } from 'rxjs';
import { OpenVaultDBAgentService } from './openvaultdb-agent.service';
import {
  AuthorizationResult,
  isAuthorizationResult,
  OpenVaultRecord,
  OpenVaultTarget,
} from './openvaultdb.models';

@Component({
  selector: 'sneat-openvaultdb-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonList,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
  templateUrl: './openvaultdb-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenVaultDBPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(OpenVaultDBAgentService);

  readonly agentId = signal('');
  readonly targets = signal<readonly OpenVaultTarget[]>([]);
  readonly targetId = signal('');
  readonly table = signal('customers');
  readonly dtql = signal('from: {name: customers}\nlimit: 20\n');
  readonly records = signal<readonly OpenVaultRecord[]>([]);
  readonly recordsTargetId = signal('');
  readonly recordsTable = signal('');
  readonly selected = signal<OpenVaultRecord | undefined>(undefined);
  readonly authorization = signal<AuthorizationResult | undefined>(undefined);
  readonly updateField = signal('name');
  readonly updateValue = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly status = signal('');
  readonly sampleLimit = signal(20);

  readonly target = computed(() =>
    this.targets().find((target) => target.id === this.targetId()),
  );

  async ngOnInit(): Promise<void> {
    this.agentId.set(this.route.snapshot.paramMap.get('agentId') ?? '');
    await this.loadTargets();
  }

  async loadTargets(): Promise<void> {
    await this.run(async () => {
      const response = await firstValueFrom(this.api.targets(this.agentId()));
      this.targets.set(response.targets);
      if (!response.targets.some((target) => target.id === this.targetId())) {
        this.targetId.set(response.targets[0]?.id ?? '');
      }
      this.status.set(
        response.targets.length ? '' : 'No OpenVaultDB targets are configured.',
      );
    });
  }

  async runQuery(): Promise<void> {
    const target = this.requireTarget();
    if (!target) return;
    const targetId = target.id;
    const table = this.table();
    const dtql = this.dtql();
    await this.run(async () => {
      const response = await firstValueFrom(
        this.api.query(this.agentId(), targetId, dtql),
      );
      if (this.targetId() !== targetId || this.table() !== table) return;
      this.records.set(response.records);
      this.recordsTargetId.set(targetId);
      this.recordsTable.set(table);
      this.selected.set(undefined);
      this.status.set(`${response.records.length} record(s)`);
    });
  }

  async explain(mode: 'plan' | 'inspect' | 'sample'): Promise<void> {
    const target = this.requireTarget();
    if (!target) return;
    const selected = this.selected();
    if (mode === 'inspect' && !selected) {
      this.error.set('Select a record before inspection.');
      return;
    }
    if (selected && !this.selectionMatches(target.id, this.table())) {
      this.error.set('Run the query again and reselect the record.');
      return;
    }
    const rowID = selected ? recordID(selected.key, this.table()) : '';
    const id = mode === 'sample' ? 'sample-template' : mode;
    const resource = {
      databaseId: target.databaseId,
      path:
        mode === 'inspect' ? `/${this.table()}/${rowID}` : `/${this.table()}`,
      table: this.table(),
      ...(mode === 'inspect' ? { rowId: rowID } : {}),
    };
    const operation =
      mode === 'plan'
        ? {
            id,
            action: 'query',
            resource,
            query: { format: 'dtql-yaml', text: this.dtql() },
            executionClass: 'dtql',
          }
        : {
            id,
            action: 'get',
            resource,
            executionClass: 'dtql',
          };
    const request = {
      apiVersion: 'dtql.org/authorization/v1',
      mode,
      diagnosticLevel: 'ordinary',
      operations: [operation],
      ...(mode === 'sample'
        ? {
            sample: {
              query: { format: 'dtql-yaml', text: this.dtql() },
              limit: Math.min(100, Math.max(1, this.sampleLimit())),
            },
          }
        : {}),
    };
    await this.run(async () => {
      const response = await firstValueFrom(
        this.api.explain(this.agentId(), target.id, request),
      );
      if (this.targetId() !== target.id || this.table() !== resource.table) return;
      this.authorization.set(response);
    });
  }

  async updateSelected(): Promise<void> {
    const target = this.requireTarget();
    const selected = this.selected();
    const field = this.updateField().trim();
    if (!target || !selected || !field || field.includes('.')) {
      this.error.set('Select a record and enter one top-level field.');
      return;
    }
    if (!this.selectionMatches(target.id, this.table())) {
      this.error.set('Run the query again and reselect the record.');
      return;
    }
    const rowID = recordID(selected.key, this.table());
    await this.run(async () => {
      let dataRevision: string;
      try {
        const evidence = await firstValueFrom(
          this.api.evidence(this.agentId(), target.id, {
            apiVersion: 'dtql.org/authorization/v1',
            resource: {
              databaseId: target.databaseId,
              path: `/${this.table()}/${rowID}`,
              rowId: rowID,
            },
            requiredFields: [[field]],
          }),
        );
        dataRevision = evidence.dataRevision;
      } catch (error: unknown) {
        const failedAuthorization = authorizationFromError(error);
        if (failedAuthorization) this.authorization.set(failedAuthorization);
        throw new Error(
          'The row could not be refreshed for a safe update. Run the query again, select the row, and retry.',
        );
      }
      if (!this.selectionMatches(target.id, this.table())) {
        throw new Error('Run the query again and reselect the record.');
      }
      const mutation: {
        changes: readonly unknown[];
        ifDataRevision?: string;
      } = {
        changes: [
          { op: 'set', path: [field], value: parseValue(this.updateValue()) },
        ],
      };
      mutation.ifDataRevision = dataRevision;
      const response = await firstValueFrom(
        this.api.update(this.agentId(), target.id, {
          id: 'update-selected',
          action: 'update',
          resource: {
            databaseId: target.databaseId,
            path: `/${this.table()}/${rowID}`,
            table: this.table(),
            rowId: rowID,
            columns: [[field]],
          },
          mutation,
          executionClass: 'dtql',
        }),
      );
      this.authorization.set(response.authorization);
      this.status.set('Row updated.');
    });
  }

  select(record: OpenVaultRecord): void {
    this.selected.set(record);
  }

  changeTarget(targetId: string): void {
    if (targetId === this.targetId()) return;
    this.targetId.set(targetId);
    this.clearQueryResult();
  }

  changeTable(table: string): void {
    if (table === this.table()) return;
    this.table.set(table);
    this.clearQueryResult();
  }

  trackRecord(_: number, record: OpenVaultRecord): string {
    return record.key;
  }

  modeLabel(mode: AuthorizationResult['mode']): string {
    return {
      plan: 'Planned access',
      inspect: 'Row access',
      sample: 'Sampled access',
      execution: 'Applied access',
    }[mode];
  }

  restrictionLabel(kind: string): string {
    return (
      {
        row_filter: 'Rows are limited',
        post_image_check: 'Changed values are checked',
        field_allowlist: 'Fields are limited',
        field_mask: 'Fields are limited',
        opaque: 'Additional limits apply',
      }[kind] ?? 'Additional limits apply'
    );
  }

  accessStateLabel(state: string): string {
    return state === 'enabled' ? 'rules enabled' : state;
  }

  private requireTarget(): OpenVaultTarget | undefined {
    const target = this.target();
    if (!target) this.error.set('Select an OpenVaultDB target.');
    return target;
  }

  private selectionMatches(targetId: string, table: string): boolean {
    return this.recordsTargetId() === targetId && this.recordsTable() === table;
  }

  private clearQueryResult(): void {
    this.records.set([]);
    this.recordsTargetId.set('');
    this.recordsTable.set('');
    this.selected.set(undefined);
    this.authorization.set(undefined);
    this.status.set('');
    this.error.set('');
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.authorization.set(undefined);
    this.error.set('');
    this.status.set('');
    try {
      await action();
    } catch (error: unknown) {
      const failedAuthorization = authorizationFromError(error);
      if (failedAuthorization) this.authorization.set(failedAuthorization);
      this.error.set(safeErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function recordID(key: string, collection: string): string {
  const prefix = `${collection}/`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 409)
    return 'The row changed since it was loaded. Run the query again and reselect it.';
  if (error instanceof Error && !error.message.includes('http'))
    return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof error.error === 'object' &&
    error.error !== null &&
    'error' in error.error
  ) {
    const detail = error.error.error;
    if (
      typeof detail === 'object' &&
      detail !== null &&
      'message' in detail &&
      typeof detail.message === 'string'
    ) {
      return detail.message;
    }
  }
  return 'The protected OpenVaultDB request failed.';
}

function authorizationFromError(error: unknown): AuthorizationResult | undefined {
  if (!(error instanceof HttpErrorResponse) || !isObject(error.error)) return undefined;
  const body = error.error;
  const candidate = isObject(body['authorization'])
    ? body['authorization']
    : isObject(body['error']) && isObject(body['error']['authorization'])
      ? body['error']['authorization']
      : undefined;
  return isAuthorizationResult(candidate) ? candidate : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
