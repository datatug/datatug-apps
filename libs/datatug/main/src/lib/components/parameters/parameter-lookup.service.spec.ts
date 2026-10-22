import { TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { of, throwError } from 'rxjs';
import { ParameterLookupService } from './parameter-lookup.service';
import { ParameterLookupComponent } from './parameter-lookup.component';
import { PublicParameterLookupService } from './public-parameter-lookup.service';
import type { ParameterLookupProvider } from './parameter-lookup-provider';
import { AgentService } from '../../services/repo/agent.service';
import type { IParameterDef } from '../../models/definition/parameter';
import { provideMockErrorLogger } from '../../testing/error-logger.spec-helper';

const explicit: IParameterDef = {
  id: 'customer', title: 'Customer', type: 'string',
  lookup: { db: 'chinook', sql: 'select * from Customer', keyFields: ['CustomerId'] },
};
const meaning: IParameterDef = { id: 'CustomerID', type: 'string', meta: { entity: 'Customer', field: 'ID' } };
const agent = { storeId: 'localhost:8989', projectId: 'demo', envId: 'dev' };
const ref = { storeId: 'github.com', projectId: 'datatug/demo' };

describe('ParameterLookupService', () => {
  let create: ReturnType<typeof vi.fn>;
  let select: ReturnType<typeof vi.fn>;
  let dismissed: { data?: unknown; role?: string };
  const publicLookup = {
    sources: vi.fn(),
    entity: vi.fn(),
    provider: vi.fn(),
  };

  beforeEach(() => {
    dismissed = { data: { value: { type: 'string', value: 'BOTTM' } }, role: 'select' };
    create = vi.fn(() => Promise.resolve({
      present: vi.fn(() => Promise.resolve()),
      onWillDismiss: vi.fn(() => Promise.resolve(dismissed)),
    }));
    select = vi.fn(() => of({
      columns: ['CustomerId', 'FirstName', 'Country'],
      rows: [
        { CustomerId: 1, FirstName: 'Luís', Country: 'Brazil' },
        { CustomerId: 2, FirstName: 'Leonie', Country: 'Germany' },
      ],
    }));
    publicLookup.sources.mockReset().mockResolvedValue([]);
    publicLookup.entity.mockReset().mockResolvedValue({ id: 'Customer' });
    publicLookup.provider.mockReset().mockReturnValue({ subject: 'Customer', sources: [], search: vi.fn() });
    TestBed.configureTestingModule({
      providers: [
        ParameterLookupService,
        provideMockErrorLogger(),
        { provide: ModalController, useValue: { create } },
        { provide: AgentService, useValue: { select } },
        { provide: PublicParameterLookupService, useValue: publicLookup },
      ],
    });
  });

  it('offers an explicit lookup only on a local agent, and a meaning lookup only with an eligible source', async () => {
    const service = TestBed.inject(ParameterLookupService);
    expect(await service.isAvailable(explicit, { explicitAgent: agent })).toBe(true);
    expect(await service.isAvailable(explicit, { projectRef: ref })).toBe(false);
    expect(await service.isAvailable({ ...explicit, lookup: { db: 'x', sql: 's', keyFields: [] } }, { explicitAgent: agent })).toBe(false);
    expect(await service.isAvailable(meaning, { projectRef: ref })).toBe(false);
    publicLookup.sources.mockResolvedValueOnce([{ id: 'nw' }]);
    expect(await service.isAvailable(meaning, { projectRef: ref })).toBe(true);
  });

  it('opens the dialog with a meaning provider and returns the picked key', async () => {
    const service = TestBed.inject(ParameterLookupService);
    publicLookup.sources.mockResolvedValue([{ id: 'nw' }]);
    const result = await service.open(meaning, { projectRef: ref }, 'ALFKI');
    expect(result).toEqual({ value: { type: 'string', value: 'BOTTM' } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      component: ParameterLookupComponent,
      componentProps: expect.objectContaining({ parameter: meaning, currentValue: 'ALFKI' }),
    }));
    expect(publicLookup.entity).toHaveBeenCalledWith(ref, 'Customer');
    dismissed = { role: 'cancel' };
    expect(await service.open(meaning, { projectRef: ref })).toBeUndefined();
  });

  it('opens nothing when no provider applies', async () => {
    const service = TestBed.inject(ParameterLookupService);
    expect(await service.open(meaning, { projectRef: ref })).toBeUndefined();
    expect(await service.open(explicit, { projectRef: ref })).toBeUndefined();
    publicLookup.sources.mockResolvedValue([{ id: 'nw' }]);
    expect(await service.open(meaning, {})).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('reads an explicit lookup once on the agent and filters its rows in the page', async () => {
    const service = TestBed.inject(ParameterLookupService);
    await service.open(explicit, { explicitAgent: agent });
    const provider = create.mock.calls[0][0].componentProps.provider as ParameterLookupProvider;
    expect(provider.preselectedSourceId).toBe('chinook');
    const signal = new AbortController().signal;
    const all = await provider.search('chinook', '', signal);
    expect(all.columns.map((c) => c.name)).toEqual(['CustomerId', 'FirstName', 'Country']);
    expect(all.rows[0][0]).toEqual({ type: 'integer', value: '1' });
    expect(all.limited).toBe(false);
    const filtered = await provider.search('chinook', 'GERM', signal);
    expect(filtered.rows).toHaveLength(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('localhost:8989', expect.objectContaining({
      proj: 'demo', env: 'dev', db: 'chinook', sql: 'select * from Customer', limit: 1001,
    }));
  });

  it('says when an explicit lookup returned more rows than it filters, and retries a failed read', async () => {
    const service = TestBed.inject(ParameterLookupService);
    const rows = Array.from({ length: 1001 }, (_, i) => ({ CustomerId: i }));
    select.mockReturnValueOnce(throwError(() => new Error('down'))).mockReturnValueOnce(of({ columns: ['CustomerId'], rows }));
    await service.open(explicit, { explicitAgent: agent });
    const provider = create.mock.calls[0][0].componentProps.provider as ParameterLookupProvider;
    const signal = new AbortController().signal;
    await expect(provider.search('chinook', '', signal)).rejects.toThrow('down');
    const page = await provider.search('chinook', '', signal);
    expect(page.rows).toHaveLength(50);
    expect(page.limited).toBe(true);
    expect(page.limitNotice).toBe('Filtering the first 1000 rows of the lookup query.');
  });
});
