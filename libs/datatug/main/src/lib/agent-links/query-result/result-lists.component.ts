import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonText } from '@ionic/angular';
import {
  ResultMeta,
  TableLink,
  columnRows,
  relatedRows,
  resultDbIds,
  sourceRows,
  unavailableText,
} from './query-result';

/** A table name of a list: it opens the table's metadata page, with a records link, or is plain text. */
@Component({
  selector: 'sneat-datatug-result-table-name',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (link(); as l) {
      <a
        data-testid="result-table-link"
        [routerLink]="l.commands"
        [queryParams]="l.queryParams"
        >{{ label() }}</a
      >
      <small>
        ·
        <a
          data-testid="result-records-link"
          [routerLink]="l.recordsCommands"
          [queryParams]="l.queryParams"
          >records</a
        ></small
      >
    } @else {
      <span data-testid="result-table-name">{{ label() }}</span>
    }
  `,
})
export class ResultTableNameComponent {
  readonly label = input.required<string>();
  readonly link = input<TableLink | undefined>(undefined);
}

/**
 * The Columns, Sources and Related views of a stored query result, drawn from its metadata only (no request is
 * made). Every source and related table is listed as the metadata reports it; nothing is filtered by permission:
 * whether a table may be read is decided when a query on it runs.
 */
@Component({
  selector: 'sneat-datatug-result-lists',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonText, ResultTableNameComponent],
  styleUrl: '../agent-link-page.scss',
  template: `
    @if (!inProject()) {
      <p data-testid="result-not-in-project">
        <ion-text color="medium"
          >This database is not in a DataTug project, so its tables cannot be
          opened here. Add it to a project to open them.</ion-text
        >
      </p>
    }
    @switch (view()) {
      @case ('columns') {
        @if (columnsNote()) {
          <p data-testid="result-unavailable">
            <ion-text color="medium">{{ columnsNote() }}</ion-text>
          </p>
        }
        <div class="link-grid-scroll">
          <table class="link-grid" data-testid="result-columns">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Declared type</th>
                <th>Nullable</th>
                <th>Key</th>
                <th>Source</th>
                <th>References</th>
              </tr>
            </thead>
            <tbody>
              @for (c of columns(); track $index) {
                <tr data-testid="result-column">
                  <td>
                    {{ c.name }}
                    @if (c.notes) {
                      <br /><small>{{ c.notes }}</small>
                    }
                  </td>
                  <td>{{ c.type }}</td>
                  <td>{{ c.declaredType }}</td>
                  <td>{{ c.nullable }}</td>
                  <td>{{ c.pk }}</td>
                  <td>
                    @if (c.source; as s) {
                      <sneat-datatug-result-table-name
                        [label]="s.label"
                        [link]="s.link"
                      />
                    }
                  </td>
                  <td>
                    @for (fk of c.foreignKeys; track $index) {
                      <div>
                        <sneat-datatug-result-table-name
                          [label]="fk.label"
                          [link]="fk.link"
                        />
                      </div>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      @case ('sources') {
        @if (sourcesNote()) {
          <p data-testid="result-unavailable">
            <ion-text color="medium">{{ sourcesNote() }}</ion-text>
          </p>
        }
        @if (sources().length) {
          <div class="link-grid-scroll">
            <table class="link-grid" data-testid="result-sources">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Alias</th>
                  <th>Kind</th>
                  <th>Role</th>
                  <th>Join</th>
                  @if (federated()) {
                    <th>Database</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (s of sources(); track $index) {
                  <tr data-testid="result-source">
                    <td>
                      <sneat-datatug-result-table-name
                        [label]="s.name"
                        [link]="s.link"
                      />
                    </td>
                    <td>{{ s.alias }}</td>
                    <td>{{ s.kind }}</td>
                    <td>{{ s.role }}</td>
                    <td>{{ s.join }}</td>
                    @if (federated()) {
                      <td>{{ s.database }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (!sourcesNote()) {
          <p data-testid="result-no-sources">
            No sources are recorded for this result.
          </p>
        }
      }
      @case ('related') {
        @if (related().length) {
          @if (relatedNote()) {
            <p data-testid="result-unavailable">
              <ion-text color="medium">{{ relatedNote() }}</ion-text>
            </p>
          }
          <div class="link-grid-scroll">
            <table class="link-grid" data-testid="result-related">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>From</th>
                  <th>Join columns</th>
                  <th>Cardinality</th>
                  <th>Direction</th>
                </tr>
              </thead>
              <tbody>
                @for (r of related(); track r.key) {
                  <tr data-testid="result-related-row">
                    <td>
                      <sneat-datatug-result-table-name
                        [label]="r.name"
                        [link]="r.link"
                      />
                    </td>
                    <td>{{ r.from }}</td>
                    <td>{{ r.joinColumns }}</td>
                    <td>{{ r.cardinality }}</td>
                    <td>{{ r.direction }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p data-testid="result-no-related">No related tables found</p>
          @if (relatedNote()) {
            <p data-testid="result-unavailable">
              <ion-text color="medium">{{ relatedNote() }}</ion-text>
            </p>
          }
        }
      }
    }
  `,
})
export class ResultListsComponent {
  readonly view = input.required<'columns' | 'sources' | 'related'>();
  readonly meta = input.required<ResultMeta>();
  readonly storeId = input.required<string>();

  readonly inProject = computed(() => !!resultDbIds(this.meta()));
  readonly columns = computed(() => columnRows(this.meta(), this.storeId()));
  readonly sources = computed(() => sourceRows(this.meta(), this.storeId()));
  readonly related = computed(() => relatedRows(this.meta(), this.storeId()));
  readonly federated = computed(() =>
    this.meta().participants.some((p) => !!p.db),
  );
  readonly columnsNote = computed(() =>
    [
      unavailableText(this.meta().unavailable.columns, 'columns'),
      unavailableText(this.meta().unavailable.declaredTypes, 'declared types'),
    ]
      .filter(Boolean)
      .join(' '),
  );
  readonly sourcesNote = computed(() =>
    unavailableText(this.meta().unavailable.participants, 'sources'),
  );
  readonly relatedNote = computed(() =>
    unavailableText(this.meta().unavailable.related, 'related tables'),
  );
}
