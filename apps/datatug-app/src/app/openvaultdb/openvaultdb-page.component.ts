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
    await this.run(async () => {
      const response = await firstValueFrom(
        this.api.query(this.agentId(), target.id, this.dtql()),
      );
      this.records.set(response.records);
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
    const id = mode === 'sample' ? 'sample-template' : mode;
    const resource = {
      databaseId: target.databaseId,
      path:
        mode === 'inspect'
          ? `/${this.table()}/${selected?.key}`
          : `/${this.table()}`,
      table: this.table(),
      ...(mode === 'inspect' ? { rowId: selected?.key } : {}),
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
      this.authorization.set(
        await firstValueFrom(
          this.api.explain(this.agentId(), target.id, request),
        ),
      );
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
    await this.run(async () => {
      let dataRevision: string;
      try {
        const evidence = await firstValueFrom(
          this.api.evidence(this.agentId(), target.id, {
            apiVersion: 'dtql.org/authorization/v1',
            resource: {
              databaseId: target.databaseId,
              path: `/${this.table()}/${selected.key}`,
              rowId: selected.key,
            },
            requiredFields: [[field]],
          }),
        );
        dataRevision = evidence.dataRevision;
      } catch {
        throw new Error(
          'The row could not be refreshed for a safe update. Run the query again, select the row, and retry.',
        );
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
            path: `/${this.table()}/${selected.key}`,
            table: this.table(),
            rowId: selected.key,
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

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.status.set('');
    try {
      await action();
    } catch (error: unknown) {
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

function safeErrorMessage(error: unknown): string {
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
