import { TestBed } from '@angular/core/testing';
import { SneatApiService } from '@sneat/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DemoDbSandboxService } from './demo-db-sandbox.service';

describe('DemoDbSandboxService', () => {
  it('uses authenticated Sneat API routes and forwards the typed SQL payload', () => {
    const api = {
      get: vi.fn(() => of({ databases: ['chinook'] })),
      post: vi.fn(() => of({ columns: [], rows: [], command: 'UPDATE 1' })),
      delete: vi.fn(() => of({})),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: SneatApiService, useValue: api }],
    });

    const service = TestBed.inject(DemoDbSandboxService);
    service.get().subscribe();
    service.create('request-123').subscribe();
    service
      .query({
        database: 'northwind',
        sql: 'UPDATE customers SET city = $1 WHERE id = $2',
        args: ['Dublin', '9007199254740993'],
      })
      .subscribe();
    service.delete().subscribe();

    expect(api.get).toHaveBeenCalledWith('ovdb/sandbox');
    expect(api.post).toHaveBeenNthCalledWith(1, 'ovdb/sandbox', {
      requestId: 'request-123',
    });
    expect(api.post).toHaveBeenNthCalledWith(2, 'ovdb/sandbox/query', {
      database: 'northwind',
      sql: 'UPDATE customers SET city = $1 WHERE id = $2',
      args: ['Dublin', '9007199254740993'],
    });
    expect(api.delete).toHaveBeenCalledWith('ovdb/sandbox');
  });
});
