import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type CellClickedEvent, type ColDef, type SelectionChangedEvent } from 'ag-grid-community';
import { Marked } from 'marked';
import { IonButton } from '@ionic/angular/ion-button';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IonContent } from '@ionic/angular/ion-content';
import { IonFooter } from '@ionic/angular/ion-footer';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonItem } from '@ionic/angular/ion-item';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonMenuButton } from '@ionic/angular/ion-menu-button';
import { IonSpinner } from '@ionic/angular/ion-spinner';
import { IonText } from '@ionic/angular/ion-text';
import { IonTextarea } from '@ionic/angular/ion-textarea';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { captureCliChatCapability, cliChatCapability } from './cli-chat-capability';

ModuleRegistry.registerModules([AllCommunityModule]);
const chatMarkdown = new Marked({ renderer: { html: () => '', image: ({ text }) => text } });

interface CliMessage {
  ID: string;
  Role: string;
  Kind: string;
  Text: string;
  RecordSetID: string;
  HTTPResponseID?: string;
}
interface CliHTTPResponse { ID?: string; CreatedAt?: string; RefreshParentID?: string; URL: string; Method?: string; RequestHasQuery?: boolean; StatusCode: number; ContentType: string; Headers: Record<string, string[]>; Body: string }

interface CliRecordSet {
  ID: string;
  Title: string;
  CreatedAt?: string;
  DTQL?: string;
  Database?: string;
  Parameters?: Record<string, unknown>;
  HTTPResponseID?: string;
  RefreshParentID?: string;
  Result: { Columns: string[]; Rows: { Key: string; Data: Record<string, unknown> }[] };
}
interface CliJoinCandidate { ID: string; Source: { Alias: string; Relation: string }; Target: { Relation: string; Schema: string }; Cardinality: string; ConstraintID: string; Fields: { SourceField: string; TargetField: string }[] }

interface ContextReference { kind: string; objectId: string; title: string; projectId?: string; sourceId?: string }
interface CliSelection { id: string; viewId: string; title: string; rows?: number[]; columns?: string[] }
interface CliView { id: string; recordSetId: string; title: string; rowIndices: number[]; columns?: string[] }
interface CliDock { id: string; reference: ContextReference; title: string }
interface CliWorkspace {
  activeTab?: string;
  attachments?: ContextReference[];
  selections?: Record<string, CliSelection>;
  views?: Record<string, CliView>;
  currentSelectionId?: string;
  docks?: CliDock[];
  exportBucket?: string[];
}
interface CliBookmark { ID: string; Title: string; ProjectID: string; SourceID: string; TargetKind: string; Tags: string[]; Snapshot: { RecordSet: CliRecordSet; View?: CliView; Selection?: CliSelection } }
interface CliProjectObject { Reference: ContextReference; Columns: string[]; ColumnTypes: Record<string, string>; QueryType: string; QueryText: string; Issue: string }
interface CliCatalog { ID: string; Title: string; Objects: CliProjectObject[] }
interface CliSavedQuery { ID: string; Title: string; Type: string; Tags: string[]; Parameters: { ID: string; Title: string; Required: boolean; DefaultValue: string }[] }
interface CliSettings { versions: number; environment: string; database: string }
interface CliHTTPSetting { kind: string; name: string; scope: string; origin: string }
interface CliCellDetail { Title: string; Column: string; Value: unknown; Row: Record<string, unknown>; Qualified: string; DBType: string; Related: { ConstraintID: string; Target: string; Columns: string[]; Rows: { Data: Record<string, unknown> }[] }[] }
interface WorkspaceAction { kind: string; reference?: ContextReference; recordSetId?: string; viewId?: string; title?: string; rows?: number[]; columns?: string[]; ranges?: { firstRow: number; lastRow: number; firstCol: number; lastCol: number }[]; dockId?: string; bookmarkId?: string; tag?: string }

interface CliSession {
  ID: string;
  Title: string;
  Messages: CliMessage[];
  RecordSets: Record<string, CliRecordSet>;
  Workspace: CliWorkspace;
  Bookmarks: Record<string, CliBookmark>;
  HTTPResponses: Record<string, CliHTTPResponse>;
}

@Component({
  selector: 'datatug-cli-chat-page',
  standalone: true,
  imports: [FormsModule, AgGridAngular, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonItem, IonLabel, IonMenuButton, IonSpinner, IonText, IonTextarea, IonTitle, IonToolbar],
  template: `
    <div class="ion-page">
      <ion-header><ion-toolbar>
        <ion-buttons slot="start"><ion-menu-button /></ion-buttons>
        <ion-title>{{ session()?.Title || 'CLI chat' }}</ion-title>
      </ion-toolbar></ion-header>
      <div class="session-bar">
        <label>Chat session <select aria-label="Chat session" [value]="session()?.ID || ''" (change)="switchSession($any($event.target).value)">
          @for (item of sessions(); track item.id) { <option [value]="item.id">{{ item.title }}</option> }
        </select></label>
        <button type="button" (click)="sessionAction('new')" [disabled]="sessionBusy()">New</button>
        <button type="button" (click)="renameSession()" [disabled]="!session() || sessionBusy()">Rename</button>
        <button type="button" (click)="confirmSessionAction('clear')" [disabled]="!session() || sessionBusy()">Clear</button>
        <button type="button" (click)="confirmSessionAction('delete')" [disabled]="!session() || sessionBusy()">Delete</button>
        <button type="button" (click)="toolsOpen.set(!toolsOpen())">{{ toolsOpen() ? 'Hide tools' : 'Tools' }}</button>
      </div>
      @if (toolsOpen()) {
        <section class="tool-drawer" aria-label="Chat tools">
          <div><strong>Connection</strong><p>{{ catalog()?.Title || 'Current project' }} · {{ settings()?.environment || 'Environment unavailable' }} · {{ settings()?.database || 'Database unavailable' }}</p><small>Connection switching is coming soon in the CLI.</small></div>
          <div><strong>Result versions to keep</strong><label><input type="number" min="1" max="100" [value]="settings()?.versions || 1" #versionsInput /> <button type="button" (click)="saveVersions(versionsInput.value)">Save</button></label></div>
          <form class="http-request-form" (submit)="$event.preventDefault(); sendHTTPRequest()">
            <strong>HTTP request</strong>
            <label>Method <select aria-label="HTTP method" [value]="httpMethod()" (change)="httpMethod.set($any($event.target).value)">@for (method of httpMethods; track method) { <option [value]="method">{{ method }}</option> }</select></label>
            <label>URL <input aria-label="HTTP URL" type="url" placeholder="https://example.com/api" [value]="httpURL()" (input)="httpURL.set($any($event.target).value)" required /></label>
            <label>Request headers <textarea aria-label="HTTP headers" placeholder="Accept: application/json" [value]="httpHeadersDraft()" (input)="httpHeadersDraft.set($any($event.target).value)"></textarea></label>
            <label>Body <textarea aria-label="HTTP body" [value]="httpBody()" (input)="httpBody.set($any($event.target).value)" [disabled]="httpMethod() === 'GET' || httpMethod() === 'HEAD'"></textarea></label>
            <button type="submit" [disabled]="!session() || !httpURL().trim() || busy()">Send HTTP request</button>
          </form>
          <div class="http-settings"><strong>HTTP headers and cookies</strong>
            <button type="button" (click)="loadHTTPSettings()">Show settings for URL</button>
            @for (setting of httpSettings(); track setting.kind + setting.name + setting.scope + setting.origin) {
              <div>{{ setting.kind }} {{ setting.name }} = [saved] · {{ setting.scope }} @if (setting.origin) { · {{ setting.origin }} }
                @if (setting.scope !== 'default') { <button type="button" (click)="removeHTTPSetting(setting)">Remove</button> }
              </div>
            }
            <label>Kind <select aria-label="HTTP setting kind" [value]="httpSettingKind()" (change)="httpSettingKind.set($any($event.target).value)"><option value="header">Header</option><option value="cookie">Cookie</option></select></label>
            <label>Name <input aria-label="HTTP setting name" [value]="httpSettingName()" (input)="httpSettingName.set($any($event.target).value)" /></label>
            <label>Value <input aria-label="HTTP setting value" type="password" [value]="httpSettingValue()" (input)="httpSettingValue.set($any($event.target).value)" /></label>
            <label>Scope <select aria-label="HTTP setting scope" [value]="httpSettingScope()" (change)="httpSettingScope.set($any($event.target).value)"><option value="project">This project</option><option value="cli">CLI wide</option></select></label>
            <button type="button" (click)="saveHTTPSetting()" [disabled]="!httpSettingName() || !httpSettingValue()">Save HTTP setting</button>
          </div>
          <div><strong>Saved project queries</strong>
            <label>Search <input type="search" [value]="querySearch()" (input)="querySearch.set($any($event.target).value)" /></label>
            @for (query of matchingQueries(); track query.ID) {
              <div class="saved-query"><span>{{ query.Title || query.ID }} · {{ query.Type }}</span>@if (query.Type === 'DTQL' || query.Type === 'HTTP') { <button type="button" (click)="runSavedQuery(query)">Run</button> }</div>
            } @empty { <p>No saved queries available.</p> }
          </div>
        </section>
      }
      <ion-content class="chat-content" [scrollY]="false">
        <div class="chat-layout">
        <div class="chat-history">
          @if (error()) { <ion-text color="danger"><p role="alert">{{ error() }}</p></ion-text> }
          @if (!session() && !error()) { <ion-spinner aria-label="Connecting to CLI chat" /> }
          @for (message of visibleMessages(); track message.ID) {
            @if (message.Kind === 'grid') {
              @if (recordSet(message.RecordSetID); as result) {
                <section class="result-card" aria-label="Query result">
                  <div class="card-heading">{{ result.Title }} @if (resultVersionBadge(result); as badge) { <small class="version-badge">{{ badge }}</small> }</div>
                  <div class="card-actions">
                    <button type="button" (click)="toggleAttachment(resultReference(message.RecordSetID, result))">{{ attached(resultReference(message.RecordSetID, result)) ? 'Detach' : 'Attach' }}</button>
                    <button type="button" (click)="workspaceAction({kind: 'dock', reference: resultReference(message.RecordSetID, result)})">Dock</button>
                    <button type="button" (click)="bookmarkResult(message.RecordSetID, result)">Bookmark</button>
                    <button type="button" (click)="workspaceAction({kind: bucketContains(message.RecordSetID) ? 'bucket_remove' : 'bucket_add', recordSetId: message.RecordSetID})">{{ bucketContains(message.RecordSetID) ? 'Remove from export bucket' : 'Add to export bucket' }}</button>
                    <button type="button" (click)="downloadResult(message.RecordSetID)">Download</button>
                    @if (result.DTQL || result.HTTPResponseID) { <button type="button" (click)="saveResultQuery(result)">Save query</button> }
                    @if (result.DTQL && !result.HTTPResponseID) { <button type="button" (click)="resultAction('refresh', message.RecordSetID)">Refresh</button> }
                    <button type="button" (click)="toggleJoins(message.RecordSetID)">Related tables</button>
                  </div>
                  <div class="result-tabs" role="tablist" [attr.aria-label]="result.Title + ' views'">
                    @for (tab of resultTabs; track tab) { <button type="button" role="tab" [attr.aria-selected]="resultTab(message.RecordSetID) === tab" (click)="setResultTab(message.RecordSetID, tab)">{{ tab }}</button> }
                  </div>
                  @if (result.Result.Rows.length) {
                    <ag-grid-angular class="ag-theme-quartz result-grid"
                      [style.display]="resultTab(message.RecordSetID) === 'Table' ? 'block' : 'none'"
                      [rowData]="gridRows(result)" [columnDefs]="gridColumns(result)"
                      [defaultColDef]="{ sortable: true, resizable: true, filter: true }"
                      [rowSelection]="{ mode: 'multiRow', checkboxes: true, headerCheckbox: false }"
                      (selectionChanged)="selectRows(message.RecordSetID, result, $event)"
                      (cellClicked)="selectCell(message.RecordSetID, result, $event)" />
                  } @else if (resultTab(message.RecordSetID) === 'Table') { <p>No matching rows.</p> }
                  @if (resultTab(message.RecordSetID) === 'Charts') {
                    @if (chartSeries(result); as series) {
                      @for (point of series; track $index) { <div class="chart-row"><span>{{ point.label }}</span><div class="chart-track"><div [style.width.%]="point.percent"></div></div><strong>{{ point.value }}</strong></div> }
                    } @else { <p>No numeric column available for a chart.</p> }
                  }
                  @if (resultTab(message.RecordSetID) === 'Current row') {
                    @if (currentResultRow(message.RecordSetID, result); as row) {
                      <dl class="selected-values">@for (column of result.Result.Columns; track column) { <div><dt>{{ column }}</dt><dd>{{ row.Data[column] ?? 'NULL' }}</dd></div> }</dl>
                    } @else { <p>No current row.</p> }
                  }
                  @if (joinsOpen()[message.RecordSetID]) {
                    <section class="join-candidates" aria-label="Related tables">
                      @for (candidate of joinCandidates()[message.RecordSetID] || []; track candidate.ID) {
                        <div class="context-card"><strong>{{ candidate.Source.Relation }} → {{ candidate.Target.Schema }}.{{ candidate.Target.Relation }}</strong><p>{{ candidate.Cardinality }} · {{ candidate.ConstraintID }}</p><button type="button" (click)="resultAction('join', message.RecordSetID, candidate.ID)">Join table</button></div>
                      } @empty { <p>No related tables available for this result.</p> }
                    </section>
                  }
                </section>
              }
            } @else if (message.Text) {
              <article class="message-card" [attr.data-message-id]="message.ID" [class.from-user]="message.Role === 'You'">
                <strong>{{ message.Role === 'You' ? 'You' : 'DataTug' }}</strong>
                @if (httpResponse(message.HTTPResponseID || ''); as response) {
                  <div class="http-summary">{{ response.StatusCode }} · {{ response.URL }}</div>
                  @if (httpVersionBadge(response); as badge) { <small class="version-badge">{{ badge }}</small> }
                  <button type="button" (click)="saveHTTPQuery(response)">Save query</button>
                  <div class="result-tabs" role="tablist" aria-label="HTTP response views">
                    @for (tab of httpTabs; track tab) { <button type="button" role="tab" [attr.aria-selected]="httpTab(message.ID) === tab" (click)="setHttpTab(message.ID, tab)">{{ tab }}</button> }
                  </div>
                  @if (httpTab(message.ID) === 'Raw') { <pre>{{ rawHttp(response) }}</pre> }
                  @else if (httpTab(message.ID) === 'Headers') { <pre>{{ httpHeaders(response) }}</pre> }
                  @else if (message.Kind === 'markdown' || response.ContentType?.includes('markdown')) { <div class="markdown-body" [innerHTML]="renderMarkdown(message.Text)"></div> }
                  @else { <p>{{ message.Text }}</p> }
                } @else if (message.Kind === 'markdown') { <div class="markdown-body" [innerHTML]="renderMarkdown(message.Text)"></div> }
                @else { <p>{{ message.Text }}</p> }
              </article>
            }
          }
          @if (sending()) { <ion-spinner aria-label="Waiting for DataTug" /> }
        </div>
        <aside class="context-panel" aria-label="Chat workspace">
          <div class="context-tabs" role="tablist" aria-label="Workspace tabs">
            @for (tab of workspaceTabs; track tab) {
              <button type="button" role="tab" [attr.aria-selected]="activeTab() === tab" (click)="setTab(tab)">{{ tab }}@if (tab === 'Docked') { {{ docks().length }} }@if (tab === 'Bookmarks') { {{ bookmarks().length }} }</button>
            }
          </div>
          <div class="context-body">
            @if (activeTab() === 'Project') {
              @for (group of projectGroups(); track group.id) {
                <details class="project-group" open>
                  <summary>{{ group.title }} · {{ group.objects.length }}</summary>
                  @for (section of group.sections; track section.id) {
                    <details class="project-section" open><summary>{{ section.title }} · {{ section.objects.length }}</summary>
                  @for (object of section.objects; track object.Reference.kind + object.Reference.objectId) {
                    <section class="context-card">
                      <div class="context-card-title"><strong>{{ object.Reference.title }}</strong><small>{{ object.Reference.kind }}</small></div>
                      @if (object.Issue) { <p role="status">{{ object.Issue }}</p> }
                      @if (object.Columns.length) { <details class="project-columns"><summary>{{ object.Columns.length }} columns</summary><dl class="selected-values">@for (column of object.Columns; track column) { <div><dt>{{ column }}</dt><dd>{{ object.ColumnTypes[column] || 'Type unavailable' }}</dd></div> }</dl></details> }
                      @if (object.QueryText) { <pre>{{ object.QueryText }}</pre> }
                      <button type="button" (click)="toggleAttachment(object.Reference)">{{ attached(object.Reference) ? 'Detach' : 'Attach' }}</button>
                    </section>
                  }
                    </details>
                  }
                </details>
              } @empty { <p class="context-empty">No project objects available.</p> }
            }
            @if (activeTab() === 'Selected') {
              @if (currentSelection(); as selection) {
                <section class="context-card">
                  <div class="context-card-title"><strong>{{ selection.title }}</strong><small>{{ (selection.rows || []).length }} rows · {{ (selection.columns || []).length }} columns</small></div>
                  <div class="inspector-tabs" role="tablist" aria-label="Selection inspector">
                    @for (tab of inspectorTabs; track tab) { <button type="button" role="tab" [attr.aria-selected]="inspectorTab() === tab" (click)="inspectorTab.set(tab)">{{ tab }}</button> }
                  </div>
                  @if (selectedRecordSet(); as record) {
                    @if (inspectorTab() === 'Current row') {
                      @for (row of selectedRows(); track $index) {
                        <dl class="selected-values">@for (column of record.Result.Columns; track column) { <div><dt>{{ column }}</dt><dd>{{ row.Data[column] ?? 'NULL' }}</dd></div> }</dl>
                      }
                    }
                    @if (inspectorTab() === 'Current column') {
                      @for (column of selection.columns || []; track column) {
                        <dl class="selected-values"><div><dt>Column</dt><dd>{{ column }}</dd></div><div><dt>Type</dt><dd>{{ cellDetail()?.Column === column ? (cellDetail()?.DBType || 'Unknown') : (columnType(column) || 'Unknown') }}</dd></div><div><dt>Source</dt><dd>{{ cellDetail()?.Column === column ? (cellDetail()?.Qualified || 'Unavailable') : 'Select a cell to inspect' }}</dd></div></dl>
                      }
                    }
                    @if (cellDetail(); as detail) {
                      <section class="cell-detail" aria-label="Cell detail">
                        <div class="context-card-title"><strong>{{ detail.Column }}</strong><button type="button" (click)="copyCellDetail(detail)">Copy value</button></div>
                        <p>Type: {{ detail.DBType || 'Unknown' }} · Source: {{ detail.Qualified || 'Unavailable' }}</p>
                        <pre>{{ detail.Value ?? 'NULL' }}</pre>
                        @for (related of detail.Related || []; track related.ConstraintID) {
                          <strong>FK {{ related.ConstraintID }} → {{ related.Target }}</strong>
                          @for (row of related.Rows || []; track $index) {
                            <dl class="selected-values">@for (column of related.Columns || []; track column) { <div><dt>{{ column }}</dt><dd>{{ row.Data[column] ?? 'NULL' }}</dd></div> }</dl>
                          } @empty { <p>No matching records.</p> }
                        }
                      </section>
                    }
                    @if (inspectorTab() === 'Current recordset') {
                      <p>{{ record.Title }} · {{ record.Result.Rows.length }} rows · {{ record.Result.Columns.length }} columns</p>
                      <dl class="selected-values">@for (column of record.Result.Columns; track column) { <div><dt>{{ column }}</dt><dd>{{ columnType(column) || 'Type unavailable' }}</dd></div> }</dl>
                    }
                  }
                  <div class="card-actions">
                    <button type="button" (click)="toggleAttachment(selectionReference(selection))">{{ attached(selectionReference(selection)) ? 'Detach' : 'Attach' }}</button>
                    <button type="button" (click)="workspaceAction({kind: 'dock', reference: selectionReference(selection)})">Dock</button>
                    <button type="button" (click)="workspaceAction({kind: 'bookmark_create', reference: selectionReference(selection)})">Bookmark</button>
                    <button type="button" (click)="workspaceAction({kind: 'clear_selection'})">Clear</button>
                  </div>
                </section>
              } @else { <p class="context-empty">Select a row or cell in a result table to inspect it here.</p> }
            }
            @if (activeTab() === 'Docked') {
              <section class="context-card" aria-label="Export bucket">
                <div class="context-card-title"><strong>Export bucket</strong><small>{{ exportBucket().length }} results</small></div>
                @for (id of exportBucket(); track id) { <p>{{ recordSet(id)?.Title || id }}</p> }
                <div class="card-actions"><button type="button" (click)="downloadResult('')" [disabled]="!exportBucket().length">Download bucket</button><button type="button" (click)="workspaceAction({kind: 'bucket_clear'})" [disabled]="!exportBucket().length">Clear bucket</button></div>
              </section>
              @for (dock of docks(); track dock.id) {
                <section class="context-card">
                  <div class="context-card-title"><strong>{{ dock.title }}</strong><button type="button" (click)="workspaceAction({kind: 'undock', dockId: dock.id})">Undock</button></div>
                  @if (dockRecordSet(dock); as record) {
                    <ag-grid-angular class="ag-theme-quartz context-grid" [rowData]="dockRows(dock, record)" [columnDefs]="dockColumns(dock, record)" [defaultColDef]="{ sortable: true, resizable: true, filter: true }" />
                  } @else { <p>Result unavailable in this session.</p> }
                </section>
              } @empty { <p class="context-empty">Dock a result or selection to keep it visible here.</p> }
            }
            @if (activeTab() === 'Bookmarks') {
              <label class="bookmark-search">Search bookmarks <input type="search" [value]="bookmarkSearch()" (input)="bookmarkSearch.set($any($event.target).value)" /></label>
              <label class="bookmark-search">Filter tag <input type="search" [value]="bookmarkTagFilter()" (input)="bookmarkTagFilter.set($any($event.target).value)" /></label>
              @for (bookmark of bookmarks(); track bookmark.ID) {
                <section class="context-card">
                  <div class="context-card-title"><strong>{{ bookmark.Title }}</strong><small>{{ bookmark.TargetKind }}</small></div>
                  @if (bookmark.Tags.length) { <div class="card-actions">@for (tag of bookmark.Tags; track tag) { <button type="button" [attr.aria-label]="'Remove tag ' + tag" (click)="workspaceAction({kind: 'bookmark_remove_tag', bookmarkId: bookmark.ID, tag})">{{ tag }} ×</button> }</div> }
                  <div class="card-actions">
                    <button type="button" (click)="openedBookmark.set(openedBookmark() === bookmark.ID ? '' : bookmark.ID)">{{ openedBookmark() === bookmark.ID ? 'Close' : 'Open' }}</button>
                    <button type="button" (click)="toggleAttachment(bookmarkReference(bookmark))">{{ attached(bookmarkReference(bookmark)) ? 'Detach' : 'Attach' }}</button>
                    <button type="button" (click)="workspaceAction({kind: 'dock', reference: bookmarkReference(bookmark)})">Dock</button>
                    <button type="button" (click)="renameBookmark(bookmark)">Rename</button>
                    <button type="button" (click)="tagBookmark(bookmark)">Tag</button>
                    <button type="button" (click)="deleteBookmark(bookmark)">Delete</button>
                  </div>
                  @if (openedBookmark() === bookmark.ID && bookmark.Snapshot.RecordSet; as record) {
                    <ag-grid-angular class="ag-theme-quartz context-grid" [rowData]="bookmarkRows(bookmark)" [columnDefs]="bookmarkColumns(bookmark)" />
                  }
                </section>
              } @empty { <p class="context-empty">No bookmarks match this search.</p> }
            }
          </div>
        </aside>
        </div>
      </ion-content>
      <ion-footer class="composer-footer"><ion-toolbar>
        @if (attachments().length) { <div class="attachment-chips" aria-label="Attached context">@for (reference of attachments(); track reference.kind + reference.objectId) { <button type="button" (click)="workspaceAction({kind: 'detach', reference})">{{ reference.title }} ×</button> }</div> }
        <div class="composer">
          <ion-item><ion-label position="stacked">Message</ion-label>
            <ion-textarea aria-label="Message to CLI chat" [autoGrow]="true" [value]="draft()" (ionInput)="draft.set($event.detail.value || '')" (keydown)="onComposerKeydown($event)" [disabled]="!session() || sending()" />
          </ion-item>
          <ion-button (click)="send()" [disabled]="!session() || !draft().trim() || sending()">Send</ion-button>
        </div>
      </ion-toolbar></ion-footer>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CliChatPageComponent implements OnInit, OnDestroy {
  readonly httpTabs = ['Rendered', 'Raw', 'Headers'];
  readonly httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  readonly httpMethod = signal('GET');
  readonly httpURL = signal('');
  readonly httpHeadersDraft = signal('');
  readonly httpBody = signal('');
  readonly httpSettings = signal<CliHTTPSetting[]>([]);
  readonly httpSettingKind = signal('header');
  readonly httpSettingName = signal('');
  readonly httpSettingValue = signal('');
  readonly httpSettingScope = signal('project');
  readonly httpTabsById = signal<Record<string, string>>({});
  readonly resultTabs = ['Table', 'Charts', 'Current row'];
  readonly resultTabsById = signal<Record<string, string>>({});
  readonly currentRowsById = signal<Record<string, number>>({});
  readonly joinsOpen = signal<Record<string, boolean>>({});
  readonly joinCandidates = signal<Record<string, CliJoinCandidate[]>>({});
  readonly workspaceTabs = ['Project', 'Selected', 'Docked', 'Bookmarks'];
  readonly inspectorTabs = ['Current row', 'Current column', 'Current recordset'];
  readonly inspectorTab = signal('Current row');
  readonly session = signal<CliSession | undefined>(undefined);
  readonly sessions = signal<{ id: string; title: string }[]>([]);
  readonly sessionBusy = signal(false);
  readonly catalog = signal<CliCatalog | undefined>(undefined);
  readonly settings = signal<CliSettings | undefined>(undefined);
  readonly visibleMessages = computed(() => {
    const session = this.session();
    if (!session) return [];
    const keep = Math.max(1, this.settings()?.versions || 2);
    const hiddenRecords = this.hiddenVersions(session.RecordSets, keep);
    const hiddenHTTP = this.hiddenVersions(session.HTTPResponses, keep);
    return session.Messages.filter((message) => {
      const record = session.RecordSets[message.RecordSetID];
      return !hiddenRecords.has(message.RecordSetID) && !hiddenHTTP.has(message.HTTPResponseID || '') && !hiddenHTTP.has(record?.HTTPResponseID || '');
    });
  });
  readonly savedQueries = signal<CliSavedQuery[]>([]);
  readonly querySearch = signal('');
  readonly matchingQueries = computed(() => this.savedQueries().filter((query) => `${query.Title} ${query.ID} ${query.Type} ${(query.Tags || []).join(' ')}`.toLowerCase().includes(this.querySearch().toLowerCase())));
  readonly toolsOpen = signal(false);
  readonly cellDetail = signal<CliCellDetail | undefined>(undefined);
  readonly projectGroups = computed(() => {
    const catalog = this.catalog();
    const objects = catalog?.Objects || [];
    const sourceNames = new Map(objects.filter((item) => item.Reference.kind === 'source').map((item) => [item.Reference.objectId, item.Reference.title]));
    const groups = new Map<string, { id: string; title: string; objects: CliProjectObject[]; sections: { id: string; title: string; objects: CliProjectObject[] }[] }>();
    for (const object of objects) {
      const id = object.Reference.sourceId || 'project';
      let group = groups.get(id);
      if (!group) {
        group = { id, title: id === 'project' ? catalog?.Title || 'Project' : sourceNames.get(id) || id, objects: [], sections: [] };
        groups.set(id, group);
      }
      group.objects.push(object);
      const kind = object.Reference.kind;
      const kindTitle = kind === 'table' ? 'Tables' : kind === 'project_view' ? 'Views' : kind === 'query' ? 'Queries' : 'Project';
      const schema = kind === 'table' || kind === 'project_view' ? object.Reference.objectId.split('.')[0] : '';
      const sectionId = schema && object.Reference.objectId.includes('.') ? `${kindTitle} · ${schema}` : kindTitle;
      let section = group.sections.find((item) => item.id === sectionId);
      if (!section) { section = { id: sectionId, title: sectionId, objects: [] }; group.sections.push(section); }
      section.objects.push(object);
    }
    return [...groups.values()];
  });
  readonly error = signal('');
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly busy = signal(false);
  readonly bookmarkSearch = signal('');
  readonly bookmarkTagFilter = signal('');
  readonly openedBookmark = signal('');
  readonly activeTab = computed(() => this.session()?.Workspace?.activeTab || 'Project');
  readonly attachments = computed(() => this.session()?.Workspace?.attachments || []);
  readonly docks = computed(() => this.session()?.Workspace?.docks || []);
  readonly exportBucket = computed(() => this.session()?.Workspace?.exportBucket || []);
  readonly bookmarks = computed(() => Object.values(this.session()?.Bookmarks || {}).filter((bookmark) => bookmark.Title.toLowerCase().includes(this.bookmarkSearch().toLowerCase()) && (!this.bookmarkTagFilter() || bookmark.Tags?.some((tag) => tag.toLowerCase().includes(this.bookmarkTagFilter().toLowerCase())))));
  readonly currentSelection = computed(() => {
    const workspace = this.session()?.Workspace;
    return workspace?.selections?.[workspace.currentSelectionId || ''];
  });
  readonly selectedRecordSet = computed(() => {
    const view = this.session()?.Workspace?.views?.[this.currentSelection()?.viewId || ''];
    return this.recordSet(view?.recordSetId || '');
  });
  readonly selectedRows = computed(() => (this.currentSelection()?.rows || []).map((index) => this.selectedRecordSet()?.Result.Rows[index]).filter((row): row is { Key: string; Data: Record<string, unknown> } => !!row));
  private timer?: ReturnType<typeof setInterval>;
  private socket?: WebSocket;
  private address = '';
  private token = '';
  private refreshSerial = 0;
  private readonly rowCache = new WeakMap<CliRecordSet, Record<string, unknown>[]>();
  private readonly columnCache = new WeakMap<CliRecordSet, ColDef[]>();
  private readonly rawHttpCache = new WeakMap<CliHTTPResponse, string>();
  private readonly markdownCache = new Map<string, string>();
  private readonly projectionCache = new Map<string, { record: CliRecordSet; signature: string; rows: Record<string, unknown>[]; columns: ColDef[] }>();
  private rangeAnchor?: { recordSetId: string; displayRow: number; column: string };
  private cellRequestSerial = 0;
  private readonly onHashChange = (): void => {
    if (!location.hash.startsWith('#h=')) return;
    captureCliChatCapability();
    this.configureBridge();
    this.socket?.close();
    this.socket = undefined;
    this.session.set(undefined);
    this.catalog.set(undefined);
    this.settings.set(undefined);
    this.savedQueries.set([]);
    this.sessions.set([]);
    this.joinCandidates.set({});
    this.joinsOpen.set({});
    this.cellDetail.set(undefined);
    this.cellRequestSerial++;
    this.rangeAnchor = undefined;
    if (this.address) { void this.refresh(); void this.loadCatalog(); void this.loadSessions(); void this.loadSettings(); void this.loadQueries(); this.connectEvents(); }
  };

  constructor() { this.configureBridge(); }

  private configureBridge(): void {
    const fragment = new URLSearchParams(cliChatCapability());
    const host = fragment.get('h') || '';
    const token = fragment.get('t') || '';
    if (!/^127\.0\.0\.1:\d{1,5}$/.test(host) || !/^[a-f0-9]{64}$/.test(token) || Number(host.split(':')[1]) > 65535) {
      this.error.set('Open this page from DataTug CLI using F5.');
      this.address = '';
      this.token = '';
    } else {
      this.address = `http://${host}/v1/chat`;
      this.token = token;
      this.error.set('');
    }
  }

  ngOnInit(): void {
    window.addEventListener('hashchange', this.onHashChange);
    if (!this.address) return;
    void this.refresh();
    void this.loadCatalog();
    void this.loadSessions();
    void this.loadSettings();
    void this.loadQueries();
    this.connectEvents();
    this.timer = setInterval(() => {
      if (!this.socket || this.socket.readyState === WebSocket.CLOSED) this.connectEvents();
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) void this.refresh();
    }, 1000);
  }

  ngOnDestroy(): void {
    window.removeEventListener('hashchange', this.onHashChange);
    if (this.timer) clearInterval(this.timer);
    this.socket?.close();
  }

  private connectEvents(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
    const socket = new WebSocket(this.address.replace('http://', 'ws://') + '/events', ['datatug-chat', this.token]);
    this.socket = socket;
    socket.onmessage = () => { void this.refresh(); void this.loadSessions(); void this.loadQueries(); void this.loadSettings(); };
    socket.onclose = () => { if (this.socket === socket) this.socket = undefined; };
    socket.onerror = () => socket.close();
  }

  recordSet(id: string): CliRecordSet | undefined { return this.session()?.RecordSets?.[id]; }
  httpResponse(id: string): CliHTTPResponse | undefined { return this.session()?.HTTPResponses?.[id]; }
  httpTab(id: string): string { return this.httpTabsById()[id] || 'Rendered'; }
  setHttpTab(id: string, tab: string): void { this.httpTabsById.update((tabs) => ({ ...tabs, [id]: tab })); }
  rawHttp(response: CliHTTPResponse): string {
    const cached = this.rawHttpCache.get(response);
    if (cached !== undefined) return cached;
    let text = '';
    try { text = new TextDecoder().decode(Uint8Array.from(atob(response.Body || ''), (char) => char.charCodeAt(0))); }
    catch { text = 'Response body is unavailable.'; }
    text = text.slice(0, 65536);
    this.rawHttpCache.set(response, text);
    return text;
  }
  renderMarkdown(value: string): string {
    const cached = this.markdownCache.get(value);
    if (cached !== undefined) return cached;
    const rendered = chatMarkdown.parse(value, { async: false }) as string;
    this.markdownCache.set(value, rendered);
    return rendered;
  }
  httpHeaders(response: CliHTTPResponse): string { return Object.entries(response.Headers || {}).map(([name, values]) => `${name}: ${values.join(', ')}`).join('\n'); }
  resultTab(id: string): string { return this.resultTabsById()[id] || 'Table'; }
  private hiddenVersions<T extends { ID?: string; CreatedAt?: string; RefreshParentID?: string }>(items: Record<string, T>, keep: number): Set<string> {
    const groups = new Map<string, { id: string; value: T }[]>();
    for (const [id, value] of Object.entries(items)) {
      let root = id;
      const seen = new Set<string>();
      while (!seen.has(root)) {
        seen.add(root);
        const parent = items[root]?.RefreshParentID;
        if (!parent || !items[parent]) break;
        root = parent;
      }
      const group = groups.get(root) || [];
      group.push({ id, value });
      groups.set(root, group);
    }
    const hidden = new Set<string>();
    for (const group of groups.values()) {
      group.sort((a, b) => (b.value.CreatedAt || '').localeCompare(a.value.CreatedAt || ''));
      for (const entry of group.slice(keep)) hidden.add(entry.id);
    }
    return hidden;
  }
  resultVersionBadge(result: CliRecordSet): string {
    const previous = this.recordSet(result.RefreshParentID || '');
    if (!previous) return '';
    return JSON.stringify([result.Result.Columns, result.Result.Rows]) === JSON.stringify([previous.Result.Columns, previous.Result.Rows]) ? 'unchanged' : 'changed';
  }
  httpVersionBadge(response: CliHTTPResponse): string {
    const previous = this.httpResponse(response.RefreshParentID || '');
    if (!previous) return '';
    return response.StatusCode === previous.StatusCode && response.ContentType === previous.ContentType && response.Body === previous.Body ? 'unchanged' : 'changed';
  }
  setResultTab(id: string, tab: string): void { this.resultTabsById.update((tabs) => ({ ...tabs, [id]: tab })); }
  currentResultRow(id: string, result: CliRecordSet): { Key: string; Data: Record<string, unknown> } | undefined { return result.Result.Rows[this.currentRowsById()[id] || 0]; }
  chartSeries(result: CliRecordSet): { label: string; value: number; percent: number }[] | undefined {
    const numeric = result.Result.Columns.find((column) => result.Result.Rows.some((row) => typeof row.Data[column] === 'number'));
    if (!numeric) return undefined;
    const labelColumn = result.Result.Columns.find((column) => column !== numeric);
    const values = result.Result.Rows.slice(0, 12).map((row, index) => ({ label: String(labelColumn ? row.Data[labelColumn] ?? index + 1 : index + 1), value: Number(row.Data[numeric]) || 0 }));
    const max = Math.max(1, ...values.map((point) => Math.abs(point.value)));
    return values.map((point) => ({ ...point, percent: Math.abs(point.value) / max * 100 }));
  }

  resultReference(id: string, result: CliRecordSet): ContextReference { return { kind: 'recordset', objectId: id, title: result.Title }; }
  selectionReference(selection: CliSelection): ContextReference { return { kind: 'selection', objectId: selection.id, title: selection.title }; }
  columnType(column: string): string {
    for (const object of this.catalog()?.Objects || []) {
      if (object.ColumnTypes?.[column]) return object.ColumnTypes[column];
    }
    return '';
  }
  bookmarkReference(bookmark: CliBookmark): ContextReference { return { kind: 'bookmark', objectId: bookmark.ID, title: bookmark.Title, projectId: bookmark.ProjectID, sourceId: bookmark.SourceID }; }
  bucketContains(id: string): boolean { return this.exportBucket().includes(id); }

  saveResultQuery(result: CliRecordSet): void {
    if (result.HTTPResponseID) {
      const response = this.httpResponse(result.HTTPResponseID);
      if (response) this.saveHTTPQuery(response);
      return;
    }
    if (!result.DTQL || Object.keys(result.Parameters || {}).length) { this.error.set('This result cannot be saved as a reusable query.'); return; }
    this.promptSaveQuery('DTQL', result.DTQL, result.Title, result.Database || '');
  }
  saveHTTPQuery(response: CliHTTPResponse): void {
    if (response.RequestHasQuery || (response.Method && response.Method !== 'GET')) { this.error.set('Only GET requests without URL parameters can be saved as project queries.'); return; }
    this.promptSaveQuery('HTTP', response.URL, response.URL, '');
  }
  private promptSaveQuery(type: 'DTQL' | 'HTTP', text: string, suggestedTitle: string, database: string): void {
    const title = window.prompt('Project query name', suggestedTitle)?.trim();
    if (!title) return;
    const tagsText = window.prompt('Tags, separated by commas', '');
    if (tagsText === null) return;
    const tags = [...new Set(tagsText.split(',').map((tag) => tag.trim()).filter(Boolean))];
    void this.saveQuery({ Title: title, Tags: tags, Type: type, Text: text, Database: database });
  }
  private async saveQuery(save: { Title: string; Tags: string[]; Type: string; Text: string; Database: string }): Promise<void> {
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!sessionId || this.busy()) return;
    this.busy.set(true);
    try {
      const response = await fetch(`${address}/queries`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token }, body: JSON.stringify({ sessionId, action: 'save', save }) });
      if (!response.ok) throw new Error(await response.text());
      if (address === this.address && token === this.token) await this.loadQueries();
    } catch (error) { if (address === this.address && token === this.token) this.error.set(`Could not save query: ${error instanceof Error ? error.message : 'unknown error'}`); }
    finally { this.busy.set(false); }
  }

  runSavedQuery(query: CliSavedQuery): void {
    const variables: Record<string, string> = {};
    for (const parameter of query.Parameters || []) {
      const value = window.prompt(parameter.Title || parameter.ID, parameter.DefaultValue || '');
      if (value === null) return;
      if (parameter.Required && !value.trim()) { this.error.set(`${parameter.Title || parameter.ID} is required.`); return; }
      variables[parameter.ID] = value;
    }
    void this.executeSavedQuery(query.ID, query.Type, variables);
  }
  private async executeSavedQuery(queryId: string, type: string, variables: Record<string, string>): Promise<void> {
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!sessionId || this.busy()) return;
    this.busy.set(true);
    try {
      const response = await fetch(`${address}/queries`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token }, body: JSON.stringify({ sessionId, action: type === 'HTTP' ? 'run_http' : 'run_dtql', queryId, variables }) });
      if (!response.ok) throw new Error(await response.text());
      if (address === this.address && token === this.token) await this.refresh();
    } catch (error) { if (address === this.address && token === this.token) this.error.set(`Could not run query: ${error instanceof Error ? error.message : 'unknown error'}`); }
    finally { this.busy.set(false); }
  }

  async sendHTTPRequest(): Promise<void> {
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!sessionId || this.busy()) return;
    const headers: Record<string, string> = {};
    for (const line of this.httpHeadersDraft().split('\n').map((item) => item.trim()).filter(Boolean)) {
      const separator = line.indexOf(':');
      if (separator < 1) { this.error.set(`Invalid HTTP header: ${line}`); return; }
      headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    this.busy.set(true);
    try {
      const response = await fetch(`${address}/http`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token }, body: JSON.stringify({ sessionId, method: this.httpMethod(), url: this.httpURL().trim(), headers, body: this.httpBody() }) });
      if (!response.ok) throw new Error(await response.text());
      if (address === this.address && token === this.token) await this.refresh();
    } catch (error) { if (address === this.address && token === this.token) this.error.set(`Could not send HTTP request: ${error instanceof Error ? error.message : 'unknown error'}`); }
    finally { this.busy.set(false); }
  }

  async loadHTTPSettings(): Promise<void> {
    const sessionId = this.session()?.ID;
    if (!sessionId) return;
    const address = this.address, token = this.token;
    try {
      const origin = encodeURIComponent(this.httpURL().trim());
      const response = await fetch(`${address}/http_settings?origin=${origin}`, { headers: { 'X-DataTug-Chat-Capability': token, 'X-DataTug-Chat-Session': sessionId }, cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      if (address === this.address && token === this.token) this.httpSettings.set(await response.json() as CliHTTPSetting[]);
    } catch (error) { if (address === this.address && token === this.token) this.error.set(`Could not load HTTP settings: ${error instanceof Error ? error.message : 'unknown error'}`); }
  }

  async saveHTTPSetting(): Promise<void> {
    await this.changeHTTPSetting('set', { kind: this.httpSettingKind(), name: this.httpSettingName().trim(), scope: this.httpSettingScope(), origin: this.httpURL().trim() }, this.httpSettingValue());
  }

  async removeHTTPSetting(setting: CliHTTPSetting): Promise<void> {
    await this.changeHTTPSetting('remove', setting, '');
  }

  private async changeHTTPSetting(action: string, setting: CliHTTPSetting, value: string): Promise<void> {
    const sessionId = this.session()?.ID;
    const address = this.address, token = this.token;
    if (!sessionId || this.busy()) return;
    this.busy.set(true);
    try {
      const response = await fetch(`${address}/http_settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token }, body: JSON.stringify({ sessionId, action, ...setting, value }) });
      if (!response.ok) throw new Error(await response.text());
      if (address === this.address && token === this.token) { this.httpSettingValue.set(''); await this.loadHTTPSettings(); }
    } catch (error) { if (address === this.address && token === this.token) this.error.set(`Could not change HTTP setting: ${error instanceof Error ? error.message : 'unknown error'}`); }
    finally { this.busy.set(false); }
  }

  private async loadQueries(): Promise<void> {
    const address = this.address;
    const token = this.token;
    if (!address) return;
    try {
      const response = await fetch(`${address}/queries`, { headers: { 'X-DataTug-Chat-Capability': token }, cache: 'no-store' });
      if (!response.ok) return;
      const queries = await response.json() as CliSavedQuery[];
      if (address === this.address && token === this.token) this.savedQueries.set(queries || []);
    } catch { /* Saved project queries are optional for this CLI project. */ }
  }

  private async loadSettings(): Promise<void> {
    const address = this.address;
    const token = this.token;
    const sessionId = this.session()?.ID;
    if (!address || !sessionId) return;
    try {
      const response = await fetch(`${address}/settings`, { headers: { 'X-DataTug-Chat-Capability': token, 'X-DataTug-Chat-Session': sessionId }, cache: 'no-store' });
      if (!response.ok) return;
      const settings = await response.json() as CliSettings;
      if (address === this.address && token === this.token && sessionId === this.session()?.ID) this.settings.set(settings);
    } catch { /* Chat remains available if settings cannot be read. */ }
  }
  async saveVersions(value: string): Promise<void> {
    const versions = Number(value);
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!sessionId || !Number.isInteger(versions) || versions < 1 || versions > 100) { this.error.set('Choose 1 to 100 result versions.'); return; }
    try {
      const response = await fetch(`${address}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token }, body: JSON.stringify({ sessionId, versions }) });
      if (!response.ok) throw new Error(await response.text());
      if (address === this.address && token === this.token) await this.loadSettings();
    } catch (error) { this.error.set(`Settings update failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
  }

  async downloadResult(recordSetId: string): Promise<void> {
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!sessionId) return;
    const format = window.prompt('Download format: csv, json, yaml, ingr, dbf, sqlite, or xlsx', 'csv')?.toLowerCase().trim();
    if (!format) return;
    if (!['csv', 'json', 'yaml', 'ingr', 'dbf', 'sqlite', 'xlsx'].includes(format)) { this.error.set('Choose a supported download format.'); return; }
    try {
      const query = new URLSearchParams({ format });
      if (recordSetId) query.set('recordSetId', recordSetId);
      const response = await fetch(`${address}/export?${query}`, { headers: { 'X-DataTug-Chat-Capability': token, 'X-DataTug-Chat-Session': sessionId }, cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      if (address !== this.address || token !== this.token || sessionId !== this.session()?.ID) return;
      const blob = await response.blob();
      const extension = !recordSetId && format !== 'xlsx' && format !== 'sqlite' ? 'zip' : format;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `datatug-chat-export.${extension}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { this.error.set(`Download failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
  }
  attached(reference: ContextReference): boolean { return this.attachments().some((item) => item.kind === reference.kind && item.objectId === reference.objectId && item.sourceId === reference.sourceId); }
  toggleAttachment(reference: ContextReference): void { void this.workspaceAction({ kind: this.attached(reference) ? 'detach' : 'attach', reference }); }
  setTab(tab: string): void { void this.workspaceAction({ kind: 'set_tab', title: tab }); }

  dockRecordSet(dock: CliDock): CliRecordSet | undefined {
    const reference = dock.reference;
    if (reference.kind === 'recordset') return this.recordSet(reference.objectId);
    if (reference.kind === 'bookmark') return this.session()?.Bookmarks?.[reference.objectId]?.Snapshot.RecordSet;
    const viewId = reference.kind === 'selection' ? this.session()?.Workspace?.selections?.[reference.objectId]?.viewId : reference.objectId;
    return this.recordSet(this.session()?.Workspace?.views?.[viewId || '']?.recordSetId || '');
  }

  private projection(record: CliRecordSet, key: string, indices?: number[], selectedColumns?: string[]): { rows: Record<string, unknown>[]; columns: ColDef[] } {
    const signature = JSON.stringify([indices, selectedColumns]);
    const cached = this.projectionCache.get(key);
    if (cached?.record === record && cached.signature === signature) return cached;
    const allRows = this.gridRows(record);
    const rows = indices ? indices.map((index) => allRows[index]).filter((row): row is Record<string, unknown> => !!row) : allRows;
    const columns = selectedColumns?.length ? selectedColumns.map((name) => ({ field: name, headerName: name })) : this.gridColumns(record);
    const result = { record, signature, rows, columns };
    this.projectionCache.set(key, result);
    return result;
  }

  private dockProjection(dock: CliDock, record: CliRecordSet): { rows: Record<string, unknown>[]; columns: ColDef[] } {
    const workspace = this.session()?.Workspace;
    const reference = dock.reference;
    if (reference.kind === 'bookmark') {
      const bookmark = this.session()?.Bookmarks?.[reference.objectId];
      return bookmark ? this.bookmarkProjection(bookmark) : this.projection(record, dock.id);
    }
    const selection = reference.kind === 'selection' ? workspace?.selections?.[reference.objectId] : undefined;
    const view = workspace?.views?.[selection?.viewId || (reference.kind === 'view' ? reference.objectId : '')];
    return this.projection(record, dock.id, selection?.rows || view?.rowIndices, selection?.columns || view?.columns);
  }
  dockRows(dock: CliDock, record: CliRecordSet): Record<string, unknown>[] { return this.dockProjection(dock, record).rows; }
  dockColumns(dock: CliDock, record: CliRecordSet): ColDef[] { return this.dockProjection(dock, record).columns; }

  private bookmarkProjection(bookmark: CliBookmark): { rows: Record<string, unknown>[]; columns: ColDef[] } {
    return this.projection(bookmark.Snapshot.RecordSet, `bookmark:${bookmark.ID}`, bookmark.Snapshot.Selection?.rows || bookmark.Snapshot.View?.rowIndices, bookmark.Snapshot.Selection?.columns || bookmark.Snapshot.View?.columns);
  }
  bookmarkRows(bookmark: CliBookmark): Record<string, unknown>[] { return this.bookmarkProjection(bookmark).rows; }
  bookmarkColumns(bookmark: CliBookmark): ColDef[] { return this.bookmarkProjection(bookmark).columns; }

  bookmarkResult(id: string, result: CliRecordSet): void {
    const title = window.prompt('Bookmark name', result.Title);
    if (title !== null) void this.workspaceAction({ kind: 'bookmark_create', reference: this.resultReference(id, result), title });
  }
  renameBookmark(bookmark: CliBookmark): void {
    const title = window.prompt('Bookmark name', bookmark.Title);
    if (title?.trim()) void this.workspaceAction({ kind: 'bookmark_rename', bookmarkId: bookmark.ID, title });
  }
  tagBookmark(bookmark: CliBookmark): void {
    const tag = window.prompt('Add tag');
    if (tag?.trim()) void this.workspaceAction({ kind: 'bookmark_add_tag', bookmarkId: bookmark.ID, tag });
  }
  deleteBookmark(bookmark: CliBookmark): void {
    if (window.confirm(`Delete bookmark "${bookmark.Title}"?`)) void this.workspaceAction({ kind: 'bookmark_delete', bookmarkId: bookmark.ID });
  }

  selectCell(id: string, result: CliRecordSet, event: CellClickedEvent): void {
    const row = (event.data as { __sourceIndex?: number } | undefined)?.__sourceIndex;
    const column = event.column?.getColId();
    if (row === undefined || !column || !result.Result.Columns.includes(column)) return;
    this.currentRowsById.update((rows) => ({ ...rows, [id]: row }));
    const displayRow = event.rowIndex ?? row;
    const displayedColumns = event.api.getAllDisplayedColumns().map((item) => item.getColId()).filter((name) => result.Result.Columns.includes(name));
    const displayColumn = displayedColumns.indexOf(column);
    if ((event.event as MouseEvent | undefined)?.shiftKey && this.rangeAnchor?.recordSetId === id) {
      const firstRow = Math.min(this.rangeAnchor.displayRow, displayRow);
      const lastRow = Math.max(this.rangeAnchor.displayRow, displayRow);
      const anchorColumn = displayedColumns.indexOf(this.rangeAnchor.column);
      if (anchorColumn < 0) { this.rangeAnchor = undefined; return; }
      const firstCol = Math.min(anchorColumn, displayColumn);
      const lastCol = Math.max(anchorColumn, displayColumn);
      const rows: number[] = [];
      for (let index = firstRow; index <= lastRow; index++) {
        const sourceIndex = (event.api.getDisplayedRowAtIndex(index)?.data as { __sourceIndex?: number } | undefined)?.__sourceIndex;
        if (sourceIndex !== undefined) rows.push(sourceIndex);
      }
      const columns = displayedColumns.slice(firstCol, lastCol + 1);
      const ranges = rows.flatMap((index) => columns.map((name) => ({ firstRow: index, lastRow: index, firstCol: result.Result.Columns.indexOf(name), lastCol: result.Result.Columns.indexOf(name) })));
      this.rangeAnchor = undefined;
      this.cellDetail.set(undefined);
      this.cellRequestSerial++;
      void this.workspaceAction({ kind: 'select', recordSetId: id, rows, columns, ranges, title: `${result.Title}: ${rows.length} rows` });
      return;
    }
    this.rangeAnchor = { recordSetId: id, displayRow, column };
    void this.workspaceAction({ kind: 'select', recordSetId: id, rows: [row], columns: [column], title: `${result.Title}: ${column}` });
    void this.loadCellDetail(id, row, column);
  }

  private async loadCellDetail(recordSetId: string, row: number, column: string): Promise<void> {
    const serial = ++this.cellRequestSerial;
    const address = this.address;
    const token = this.token;
    const sessionId = this.session()?.ID;
    if (!sessionId) return;
    try {
      const query = new URLSearchParams({ recordSetId, row: String(row), column });
      const response = await fetch(`${address}/cell_detail?${query}`, { headers: { 'X-DataTug-Chat-Capability': token, 'X-DataTug-Chat-Session': sessionId }, cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const detail = await response.json() as CliCellDetail;
      if (serial === this.cellRequestSerial && address === this.address && token === this.token && sessionId === this.session()?.ID) this.cellDetail.set(detail);
    } catch (error) { if (serial === this.cellRequestSerial && address === this.address && token === this.token) this.error.set(`Cell detail unavailable: ${error instanceof Error ? error.message : 'unknown error'}`); }
  }
  copyCellDetail(detail: CliCellDetail): void { void navigator.clipboard.writeText(detail.Value == null ? 'NULL' : String(detail.Value)); }

  async toggleJoins(id: string): Promise<void> {
    const opening = !this.joinsOpen()[id];
    this.joinsOpen.update((items) => ({ ...items, [id]: opening }));
    if (!opening || !this.session()?.ID) return;
    const address = this.address;
    const token = this.token;
    const sessionId = this.session()?.ID;
    try {
      const query = new URLSearchParams({ recordSetId: id });
      const response = await fetch(`${address}/join_candidates?${query}`, { headers: { 'X-DataTug-Chat-Capability': token, 'X-DataTug-Chat-Session': sessionId || '' }, cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const candidates = await response.json() as CliJoinCandidate[];
      if (address === this.address && token === this.token && sessionId === this.session()?.ID) this.joinCandidates.update((items) => ({ ...items, [id]: candidates }));
    } catch (error) { this.error.set(`Could not load related tables: ${error instanceof Error ? error.message : 'unknown error'}`); }
  }

  async resultAction(action: 'join' | 'refresh', recordSetId: string, candidateId = ''): Promise<void> {
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!sessionId || this.busy()) return;
    this.busy.set(true);
    try {
      const response = await fetch(`${address}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token },
        body: JSON.stringify({ sessionId, recordSetId, action, candidateId }),
      });
      if (!response.ok) throw new Error(await response.text());
      if (address === this.address && token === this.token) await this.refresh();
    } catch (error) {
      if (address === this.address && token === this.token) this.error.set(`Result action failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally { this.busy.set(false); }
  }

  selectRows(id: string, result: CliRecordSet, event: SelectionChangedEvent): void {
    const rows = event.api.getSelectedRows().map((row: { __sourceIndex?: number }) => row.__sourceIndex).filter((index): index is number => index !== undefined);
    if (!rows.length) return;
    void this.workspaceAction({ kind: 'select', recordSetId: id, rows, columns: result.Result.Columns, title: `${result.Title}: ${rows.length} rows` });
  }

  async workspaceAction(action: WorkspaceAction): Promise<void> {
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!sessionId || this.busy()) return;
    this.busy.set(true);
    try {
      const response = await fetch(`${address}/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token },
        body: JSON.stringify({ sessionId, action }),
      });
      if (!response.ok) throw new Error(await response.text());
      if (address === this.address && token === this.token) await this.refresh();
    } catch (error) {
      if (address === this.address && token === this.token) this.error.set(`Workspace action failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally { this.busy.set(false); }
  }

  private async loadCatalog(): Promise<void> {
    const address = this.address;
    const token = this.token;
    try {
      const response = await fetch(`${address}/catalog`, { headers: { 'X-DataTug-Chat-Capability': token }, cache: 'no-store' });
      if (!response.ok) throw new Error('catalog unavailable');
      const catalog = await response.json() as CliCatalog;
      catalog.Objects ||= [];
      for (const object of catalog.Objects) { object.Columns ||= []; object.ColumnTypes ||= {}; }
      if (address === this.address && token === this.token) this.catalog.set(catalog);
    } catch { if (address === this.address && token === this.token) this.catalog.set(undefined); }
  }

  private async loadSessions(): Promise<void> {
    const address = this.address;
    const token = this.token;
    try {
      const response = await fetch(`${address}/sessions`, { headers: { 'X-DataTug-Chat-Capability': token }, cache: 'no-store' });
      if (!response.ok) return;
      const items = await response.json() as { id: string; title: string }[];
      if (address === this.address && token === this.token) this.sessions.set(items);
    } catch { /* The current chat remains usable if the session list is unavailable. */ }
  }

  switchSession(id: string): void { if (id && id !== this.session()?.ID) void this.sessionAction('switch', id); }
  renameSession(): void {
    const title = window.prompt('Chat name', this.session()?.Title || '');
    if (title?.trim()) void this.sessionAction('rename', title);
  }
  confirmSessionAction(action: 'clear' | 'delete'): void {
    const description = action === 'clear' ? 'Clear this chat and remove its messages and result snapshots?' : 'Delete this chat and its result snapshots?';
    if (window.confirm(description)) void this.sessionAction(action, 'confirm');
  }
  async sessionAction(action: 'new' | 'switch' | 'rename' | 'clear' | 'delete', value = ''): Promise<void> {
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!sessionId || this.sessionBusy()) return;
    this.sessionBusy.set(true);
    try {
      const response = await fetch(`${address}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token },
        body: JSON.stringify({ sessionId, action, value }),
      });
      if (!response.ok) throw new Error(await response.text());
      if (address === this.address && token === this.token) { await this.refresh(); await this.loadSessions(); }
    } catch (error) {
      if (address === this.address && token === this.token) this.error.set(`Chat session action failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally { this.sessionBusy.set(false); }
  }

  gridRows(result: CliRecordSet): Record<string, unknown>[] {
    let rows = this.rowCache.get(result);
    if (!rows) {
      rows = result.Result.Rows.map((row, index) => ({ ...row.Data, __sourceIndex: index }));
      this.rowCache.set(result, rows);
    }
    return rows;
  }

  gridColumns(result: CliRecordSet): ColDef[] {
    let columns = this.columnCache.get(result);
    if (!columns) {
      columns = result.Result.Columns.map((column) => ({ field: column, headerName: column }));
      this.columnCache.set(result, columns);
    }
    return columns;
  }

  private async refresh(): Promise<void> {
    const serial = ++this.refreshSerial;
    const address = this.address;
    const token = this.token;
    try {
      const response = await fetch(`${address}/session`, { headers: { 'X-DataTug-Chat-Capability': token }, cache: 'no-store' });
      if (!response.ok) throw new Error(`CLI chat returned ${response.status}`);
      const session = await response.json() as CliSession;
      session.Messages ||= [];
      session.RecordSets ||= {};
      session.Workspace ||= {};
      session.Bookmarks ||= {};
      session.HTTPResponses ||= {};
      for (const record of Object.values(session.RecordSets)) { record.Result.Columns ||= []; record.Result.Rows ||= []; }
      for (const bookmark of Object.values(session.Bookmarks)) {
        bookmark.Tags ||= [];
        if (bookmark.Snapshot?.RecordSet?.Result) {
          bookmark.Snapshot.RecordSet.Result.Columns ||= [];
          bookmark.Snapshot.RecordSet.Result.Rows ||= [];
        }
      }
      if (serial !== this.refreshSerial || address !== this.address || token !== this.token) return;
      const previous = this.session();
      if (previous) {
        for (const [id, recordSet] of Object.entries(session.RecordSets || {})) {
          const prior = previous.RecordSets?.[id];
          if (prior && JSON.stringify(prior) === JSON.stringify(recordSet)) {
            session.RecordSets[id] = prior;
          }
        }
      }
      this.session.set(session);
      if (previous?.ID !== session.ID) { this.cellDetail.set(undefined); this.cellRequestSerial++; this.rangeAnchor = undefined; void this.loadSettings(); }
      this.error.set('');
    } catch {
      if (serial !== this.refreshSerial || address !== this.address || token !== this.token) return;
      this.error.set('Cannot reach this CLI chat. Keep DataTug running and check that the browser permits local connections.');
    }
  }

  async send(): Promise<void> {
    const text = this.draft().trim();
    const sessionId = this.session()?.ID;
    const address = this.address;
    const token = this.token;
    if (!text || !sessionId || this.sending()) return;
    this.sending.set(true);
    try {
      const response = await fetch(`${address}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DataTug-Chat-Capability': token },
        body: JSON.stringify({ text, sessionId }),
      });
      if (!response.ok) throw new Error(`CLI chat returned ${response.status}`);
      if (address !== this.address || token !== this.token) return;
      this.draft.set('');
      await this.refresh();
    } catch {
      if (address !== this.address || token !== this.token) return;
      this.error.set('Could not send this message. Check the CLI session and try again.');
    } finally {
      this.sending.set(false);
    }
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }
}
