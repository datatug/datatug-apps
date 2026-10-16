import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AgentTableRef, classifyAgentError } from '../agent-link-api.service';
import { TableMetadataComponent } from './table-metadata.component';

const REF: AgentTableRef = {
  storeId: 'http-127.0.0.1:8989',
  project: 'demo',
  env: 'local',
  source: 'chinook',
  table: { schema: '', name: 'Album' },
};
const SCHEMA_URL = 'http://127.0.0.1:8989/datatug/records/schema';

function mount() {
  TestBed.configureTestingModule({
    imports: [TableMetadataComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(TableMetadataComponent);
  fixture.componentRef.setInput('tableRef', REF);
  fixture.detectChanges();
  return { fixture, ctrl: TestBed.inject(HttpTestingController) };
}

describe('TableMetadataComponent', () => {
  it('shows the live columns, types, primary key and referencing tables of a schemaless table', async () => {
    const { fixture, ctrl } = mount();
    const req = ctrl.expectOne(SCHEMA_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      project: 'demo',
      env: 'local',
      source: 'chinook',
      schema: '',
      table: 'Album',
    });
    expect(req.request.url).not.toContain('?');
    req.flush({
      source: 'chinook',
      schema: '',
      table: 'Album',
      columns: [
        { name: 'AlbumId', type: 'int' },
        { name: 'Title', type: 'string' },
        { name: 'ArtistId', type: 'int' },
      ],
      primaryKey: ['AlbumId'],
      referencedBy: ['Track'],
    });
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const columns = el.querySelector('[data-testid="table-metadata-columns"]')?.textContent ?? '';
    for (const text of ['AlbumId', 'Title', 'ArtistId', 'int', 'string', 'PK']) {
      expect(columns).toContain(text);
    }
    expect(el.querySelector('[data-testid="table-metadata-pk"]')?.textContent).toContain('AlbumId');
    expect(el.querySelector('[data-testid="table-metadata-referenced-by"]')?.textContent).toContain('Track');
    ctrl.verify();
  });

  it('names the problem when the agent does not know the table', async () => {
    const { fixture, ctrl } = mount();
    ctrl.expectOne(SCHEMA_URL).flush(
      { error: { code: 'NOT_FOUND', message: 'unknown table', field: 'table', requestId: 'r' } },
      { status: 404, statusText: 'Not Found' },
    );
    await fixture.whenStable();
    expect(fixture.componentInstance.problem()).toBe('table-not-found');
    expect(fixture.nativeElement.textContent).toContain('table-not-found');
  });
});

describe('classifyAgentError', () => {
  const err = (status: number, field?: string) =>
    new HttpErrorResponse({
      status,
      error: field ? { error: { code: 'X', message: 'm', field, requestId: 'r' } } : null,
    });
  it.each([
    [err(0), 'agent-unreachable'],
    [err(403), 'agent-unreachable'],
    [err(401), 'link-expired'],
    [err(404, 'project'), 'project-not-found'],
    [err(404, 'source'), 'database-not-found'],
    [err(404, 'env'), 'database-not-found'],
    [err(404, 'table'), 'table-not-found'],
    [err(404, 'schema'), 'table-not-found'],
    [err(404, 'key'), 'record-not-found'],
    [err(400, 'key'), 'bad-key'],
    [err(400, 'table'), 'read-failed'],
    [err(500), 'read-failed'],
    // A reachable agent answers 503 SOURCE_UNAVAILABLE and 504 TIMEOUT on data routes: not unreachable.
    [err(503, 'source'), 'read-failed'],
    [err(504), 'read-failed'],
    [new Error('x'), 'read-failed'],
  ])('%# classifies as %s', (e, problem) => {
    expect(classifyAgentError(e)).toBe(problem);
  });
});
