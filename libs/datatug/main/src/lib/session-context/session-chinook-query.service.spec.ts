import { TestBed } from '@angular/core/testing';
import { PublicSqliteQueryService } from '../queries/public-sqlite-query.service';
import { SessionChinookQueryService } from './session-chinook-query.service';

describe('SessionChinookQueryService', () => {
  it('uses the typed pinned fixture worker even when session context is local', async () => {
    const project = { storeId: 'http-127.0.0.1:18990', projectId: 'datatug-demo-project' };
    const definition = { connectionId: 'chinook-sqlite' } as never;
    const fixtureResult = {
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
    };
    const sqlite = {
      runParameterized: vi.fn(async () => fixtureResult),
      run: vi.fn(async () => fixtureResult),
    };
    TestBed.configureTestingModule({ providers: [SessionChinookQueryService, { provide: PublicSqliteQueryService, useValue: sqlite }] });
    const service = TestBed.inject(SessionChinookQueryService);
    const output = await service.execute(project, { environmentId: 'local', identityDomain: 'local-demo' }, definition,
      { type: 'integer', value: '1' });
    expect(sqlite.runParameterized).toHaveBeenCalledWith(project, definition, { InvoiceId: { type: 'integer', value: '1' } });
    expect(sqlite.run).not.toHaveBeenCalled();
    expect(output.columns).toEqual([{ field: 'InvoiceId' }]);
    expect(output.rows).toEqual([{ InvoiceId: '1' }]);
  });
});
