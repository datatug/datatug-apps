import { TestBed } from '@angular/core/testing';
import { ActionSheetController } from '@ionic/angular';
import { RandomIdService } from '@sneat/random';
import { of } from 'rxjs';

import { QueriesUiService } from './queries-ui.service';
import { QueryEditorStateService } from './query-editor-state-service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';

describe('QueriesUiService', () => {
  const sheet = { present: vi.fn(), onDidDismiss: vi.fn() };
  const createSheet = vi.fn(async (options: { buttons: { text: string; handler?: () => void }[] }) => {
    sheetOptions = options;
    return sheet;
  });
  let sheetOptions: { buttons: { text: string; handler?: () => void }[] };
  const newQuery = vi.fn((qs: unknown) => qs);
  const goQuery = vi.fn();

  beforeEach(() => {
    sheetOptions = { buttons: [] };
    newQuery.mockClear();
    goQuery.mockClear();
    createSheet.mockClear();
    TestBed.configureTestingModule({
      providers: [
        QueriesUiService,
        {
          provide: RandomIdService,
          useValue: { newRandomId: vi.fn(() => 'test-id') },
        },
        {
          provide: ActionSheetController,
          useValue: {
            create: createSheet,
          },
        },
        {
          provide: QueryEditorStateService,
          useValue: {
            newQuery,
            queryEditorState: of(undefined),
          },
        },
        {
          provide: DatatugNavService,
          useValue: { goQuery },
        },
      ],
    });
  });

  it('should be created', () => {
    expect(TestBed.inject(QueriesUiService)).toBeTruthy();
  });

  it('offers a one-table hosted DemoDB query with a persisted DTQL source definition', async () => {
    const projectRef = { storeId: 'github.com', projectId: 'owner/repo' };
    await TestBed.inject(QueriesUiService).openNewQuery(projectRef);

    const option = sheetOptions.buttons.find((button) =>
      button.text === 'Hosted DemoDB table (DTQL)');
    expect(option).toBeDefined();
    option?.handler?.();

    expect(newQuery).toHaveBeenCalledOnce();
    const state = newQuery.mock.calls[0][0] as {
      isNew: boolean;
      queryType: string;
      request: { queryType: string; text?: string };
      federation: { ovdbBaseUrl: string; tables: { database: string; name: string }[] };
    };
    expect(state).toMatchObject({
      isNew: true,
      queryType: 'DTQL',
      request: { queryType: 'DTQL' },
      federation: {
        ovdbBaseUrl: 'https://demodb.dev/ovdb',
        tables: [{ database: 'chinook', name: 'Customer' }],
      },
    });
    expect(state.request.text).toContain('database: chinook');
    expect(goQuery).toHaveBeenCalledOnce();
  });

  it('uses the selected request type for regular SQL and HTTP drafts', async () => {
    await TestBed.inject(QueriesUiService).openNewQuery({
      storeId: 'github.com', projectId: 'owner/repo',
    });
    sheetOptions.buttons.find((button) => button.text === 'SQL')?.handler?.();
    sheetOptions.buttons.find((button) => button.text === 'HTTP')?.handler?.();

    expect(newQuery.mock.calls.map(([state]) => (state as { request: { queryType: string } }).request.queryType))
      .toEqual(['SQL', 'HTTP']);
  });
});
