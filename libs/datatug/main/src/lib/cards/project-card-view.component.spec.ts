import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of, throwError } from 'rxjs';
import type { ProjectCard } from '@datatug/board-models';
import { BoardCardComponent } from '../board/ui/components/board-card/board-card.component';
import { BoardPresentationSelection } from '../board/core/board-presentation-selection';
import {
  BoardQueryResults,
  PROJECT_CARD_RESULTS_OPTIONS,
} from '../board/core/board-query-results.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { QueriesService } from '../queries/queries.service';
import { QueryDispatchService } from '../queries/query-dispatch.service';
import { QueryType } from '../models/definition/query-def';
import { CardNotFoundError, ProjectCardsService } from './project-cards.service';
import {
  ProjectCardViewComponent,
  cardQueryIds,
} from './project-card-view.component';

const ref = { storeId: 'localhost:8989', projectId: 'demo' };
const rows = {
  recordset: {
    columns: [{ name: 'Name', type: 'string' }],
    rows: [[{ type: 'string', value: 'Ann' }]],
  },
  provenance: { source: 'test' },
  truncated: false,
};
const queryCard = (extra: Partial<ProjectCard> = {}): ProjectCard => ({
  id: 'customer',
  title: 'Customer',
  description: 'One customer',
  parameters: [
    { id: 'customerId', type: 'string', isRequired: true },
    ...(extra.parameters ?? []),
  ],
  widget: {
    name: 'fields',
    data: {
      source: {
        queryId: 'customers/by-id',
        parameters: [{ id: 'id', boardParameterId: 'customerId' }],
      },
    },
  },
  ...extra,
  ...(extra.parameters
    ? {
        parameters: [
          { id: 'customerId', type: 'string', isRequired: true },
          ...extra.parameters,
        ],
      }
    : {}),
});

describe('ProjectCardViewComponent', () => {
  const getQuery = vi.fn();
  const run = vi.fn();
  const getCard = vi.fn();
  let fixture: ComponentFixture<ProjectCardViewComponent>;

  beforeEach(async () => {
    getQuery.mockReset().mockReturnValue(
      of({
        id: 'customers/by-id',
        title: 'C',
        request: { queryType: QueryType.SQL, text: 'select 1' },
        connectionId: 'c',
        parameters: [{ id: 'id', type: 'string', isRequired: true }],
      }),
    );
    run.mockReset().mockResolvedValue(rows);
    getCard.mockReset();
    await TestBed.configureTestingModule({
      imports: [ProjectCardViewComponent],
      providers: [
        BoardPresentationSelection,
        { provide: PLATFORM_ID, useValue: 'server' },
        provideRouter([]),
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: new BehaviorSubject(undefined),
            currentEnv: of(undefined),
          },
        },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject({ status: 'notAuthenticated' }),
          },
        },
        { provide: QueriesService, useValue: { getQuery } },
        {
          provide: QueryDispatchService,
          useValue: {
            executeHeld: async (...args: unknown[]) => ({
              result: await run(...args),
            }),
            runtimeRevision: signal(0).asReadonly(),
            availableWorkingCopies: async () => [],
          },
        },
        {
          provide: ProjectCardsService,
          useValue: { getCard, invalidate: vi.fn() },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectCardViewComponent);
  });

  async function settle(f: ComponentFixture<unknown> = fixture): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await f.whenStable();
      await Promise.resolve();
      f.detectChanges();
    }
  }
  const text = (f: ComponentFixture<unknown> = fixture): string =>
    f.nativeElement.textContent ?? '';

  it('fills an input from the lookup, marks it "from lookup", and drops the mark on a hand edit', async () => {
    fixture.componentRef.setInput('card', queryCard());
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('environment', 'dev');
    await settle();
    const view = fixture.componentInstance;
    expect(view.lookupContext()).toEqual({ projectRef: ref, environment: 'dev' });
    expect(view.draftText('customerId')).toBeUndefined();
    view.onLookupPicked('customerId', { value: 'BOTTM', key: { type: 'string', value: 'BOTTM' } });
    expect(view.draft()['customerId']).toBe('BOTTM');
    expect(view.draftText('customerId')).toBe('BOTTM');
    expect(view.lookupPicked()).toEqual({ customerId: true });
    view.setDraft('customerId', 'BOTT');
    expect(view.lookupPicked()).toEqual({});
    expect(view.asParameterDef({ id: 'x', type: 'string' }).id).toBe('x');
  });

  it('renders a card through board-card with its parameter bound (AC customer-card)', async () => {
    fixture.componentRef.setInput('card', queryCard());
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('parameterValues', { customerId: 'ALFKI' });
    await settle();
    expect(fixture.nativeElement.querySelector('sneat-datatug-board-card')).not.toBeNull();
    expect(text()).toContain('Customer');
    expect(text()).toContain('Ann');
    const request = run.mock.calls[0][0] as { parameters: Record<string, unknown> };
    expect(request.parameters['id']).toEqual({ type: 'string', value: 'ALFKI' });
  });

  it('renders no tab strip for one tab and shows both widgets with their titles (AC tabs-text-fields)', async () => {
    const card: ProjectCard = {
      id: 'tt',
      title: 'TT',
      parameters: [{ id: 'who', type: 'string' }, { id: 'row', type: 'record' }],
      widget: {
        name: 'tabs',
        data: {
          tabs: [
            {
              title: 'Only',
              widgets: [
                { name: 'text', data: { title: 'Note', markdown: 'Hi {{who}}' } },
                { name: 'fields', data: { title: 'Record', source: { parameter: 'row' } } },
              ],
            },
          ],
        },
      },
    };
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('parameterValues', {
      who: '](javascript:alert(1))',
      row: { Name: 'Ann' },
    });
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('ion-segment')).toBeNull();
    expect(text()).toContain('Note');
    expect(text()).toContain('Record');
    expect(text()).toContain('Hi ](javascript:alert(1))');
    expect(el.querySelector('a')).toBeNull();
    expect(text()).toContain('Ann');
  });

  it('shows a tab strip for several tabs and stacks widgets[] of the active tab', async () => {
    const card: ProjectCard = {
      id: 'multi',
      title: 'Multi',
      widget: {
        name: 'tabs',
        data: {
          tabs: [
            { id: 'a', title: 'First', widgets: [{ name: 'text', data: { markdown: 'one' } }, { name: 'text', data: { markdown: 'two' } }] },
            { id: 'b', title: 'Second', widget: { name: 'text', data: { markdown: 'legacy' } } },
          ],
        },
      },
    };
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('projectRef', ref);
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('ion-segment')).not.toBeNull();
    expect(text()).toContain('one');
    expect(text()).toContain('two');
    expect(text()).not.toContain('legacy');
  });

  it('keeps sibling widgets rendering when one fails', async () => {
    run.mockRejectedValue(new Error('boom'));
    const card: ProjectCard = {
      id: 'sib',
      title: 'Sib',
      widget: {
        name: 'tabs',
        data: {
          tabs: [
            {
              title: 'Only',
              widgets: [
                { name: 'SQL', data: { sql: { queryId: 'customers/by-id', parameters: [{ id: 'id', value: 'x' }] } } },
                { name: 'text', data: { markdown: 'still here' } },
                { name: 'mystery', data: {} },
              ],
            },
          ],
        },
      },
    };
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('projectRef', ref);
    await settle();
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
    expect(text()).toContain('still here');
    expect(text()).toContain('Unsupported widget: mystery');
  });

  it('asks for a missing required input and issues no query until it is filled (AC missing-input)', async () => {
    fixture.componentRef.setInput(
      'card',
      queryCard({ parameters: [{ id: 'region', type: 'string', isRequired: true, title: 'Region' }] }),
    );
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('parameterValues', { customerId: 'ALFKI' });
    const emitted: Record<string, unknown>[] = [];
    fixture.componentInstance.parameterValuesChange.subscribe((v) => emitted.push(v));
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('form[aria-label="Card inputs"]')).not.toBeNull();
    expect(el.querySelector('[data-parameter=region]')).not.toBeNull();
    expect(el.querySelector('[data-parameter=customerId]')).toBeNull();
    expect(run).not.toHaveBeenCalled();

    // empty submit reports the problem and emits nothing
    fixture.componentInstance.submit();
    await settle();
    expect(text()).toContain('Enter Region.');
    expect(emitted).toEqual([]);

    fixture.componentInstance.setDraft('region', 'EU');
    fixture.componentInstance.submit();
    await settle();
    expect(emitted).toEqual([{ customerId: 'ALFKI', region: 'EU' }]);
    expect(el.querySelector('form')).toBeNull();
    expect(run).toHaveBeenCalledOnce();
  });

  it('keeps values entered inline when the same supplied values arrive again, and drops them for different ones', async () => {
    fixture.componentRef.setInput(
      'card',
      queryCard({ parameters: [{ id: 'region', type: 'string', isRequired: true, title: 'Region' }] }),
    );
    fixture.componentRef.setInput('projectRef', ref);
    fixture.componentRef.setInput('parameterValues', { customerId: 'ALFKI' });
    await settle();
    fixture.componentInstance.setDraft('region', 'EU');
    fixture.componentInstance.submit();
    await settle();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    // an equal object (what a page produces on every render) is not new input
    fixture.componentRef.setInput('parameterValues', { customerId: 'ALFKI' });
    await settle();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    // other values start over
    fixture.componentRef.setInput('parameterValues', { customerId: 'ANATR' });
    await settle();
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('shares one query between cards of the same cache and refresh refetches (AC cache)', async () => {
    const cache = new BoardQueryResults(PROJECT_CARD_RESULTS_OPTIONS);
    const second = TestBed.createComponent(ProjectCardViewComponent);
    for (const f of [fixture, second]) {
      f.componentRef.setInput('card', queryCard());
      f.componentRef.setInput('projectRef', ref);
      f.componentRef.setInput('cache', cache);
      f.componentRef.setInput('parameterValues', { customerId: 'ALFKI' });
    }
    await settle(fixture);
    await settle(second);
    expect(run).toHaveBeenCalledOnce();
    expect(text(second)).toContain('Ann');

    fixture.componentInstance.refresh();
    await settle(fixture);
    expect(run).toHaveBeenCalledTimes(2);

    // another customer is another key
    second.componentRef.setInput('parameterValues', { customerId: 'BONAP' });
    await settle(second);
    expect(run).toHaveBeenCalledTimes(3);
    cache.ngOnDestroy();
  });

  it('collects the saved queries a card reads', () => {
    expect(
      cardQueryIds({
        widget: {
          name: 'tabs',
          data: {
            tabs: [
              { title: 't', widget: { name: 'SQL', data: { sql: { queryId: 'a' } } } },
              { title: 'u', widgets: [{ name: 'fields', data: { source: { queryId: 'b' } } }, { name: 'chart', data: { sources: [{ queryId: 'c' }] } }] },
            ],
          },
        },
      }).sort(),
    ).toEqual(['a', 'b', 'c']);
  });

  describe('dashboard cell with ref (AC shared-renderer)', () => {
    let cell: ComponentFixture<BoardCardComponent>;
    beforeEach(() => {
      fixture.destroy(); // an unset required input would fail the shared change-detection tick
      cell = TestBed.createComponent(BoardCardComponent);
      cell.componentRef.setInput('projectRef', ref);
      cell.componentRef.setInput('boardId', 'dash');
      cell.componentRef.setInput('boardContext', {
        mode: 'view',
        parameters: { picked: { type: 'string', value: 'ALFKI' } },
      });
    });

    it('resolves the card, binds board parameters and renders without a card in a card', async () => {
      getCard.mockReturnValue(of(queryCard()));
      cell.componentRef.setInput('boarCardDef', {
        id: 'cell1',
        title: 'Customer cell',
        ref: {
          cardId: 'customer',
          parameters: [{ id: 'customerId', boardParameterId: 'picked' }],
        },
      });
      await settle(cell);
      expect(getCard).toHaveBeenCalledWith(ref, 'customer', undefined);
      const el: HTMLElement = cell.nativeElement;
      expect(text(cell)).toContain('Customer cell');
      expect(text(cell)).toContain('Ann');
      expect(el.querySelectorAll('ion-card')).toHaveLength(1);
      expect(el.querySelectorAll('sneat-datatug-board-card')).toHaveLength(1);
      const request = run.mock.calls[0][0] as { parameters: Record<string, unknown> };
      expect(request.parameters['id']).toEqual({ type: 'string', value: 'ALFKI' });
    });

    it('binds a constant and falls back to the parameter default', async () => {
      getCard.mockReturnValue(
        of(
          queryCard({
            parameters: [],
          }),
        ),
      );
      cell.componentRef.setInput('boarCardDef', {
        id: 'cell2',
        title: 'Const',
        ref: { cardId: 'customer', parameters: [{ id: 'customerId', value: 'CONST' }] },
      });
      await settle(cell);
      const request = run.mock.calls[0][0] as { parameters: Record<string, unknown> };
      expect(request.parameters['id']).toEqual({ type: 'string', value: 'CONST' });
    });

    it('shows "Card not found: <id>" for an unresolved reference', async () => {
      getCard.mockReturnValue(throwError(() => new CardNotFoundError('customer')));
      cell.componentRef.setInput('boarCardDef', {
        id: 'cell3',
        title: 'Missing',
        ref: { cardId: 'customer' },
      });
      await settle(cell);
      expect(text(cell)).toContain('Card not found: customer');
      expect(run).not.toHaveBeenCalled();
    });

    it('shows the failure with Retry when the card cannot be loaded', async () => {
      getCard.mockReturnValueOnce(throwError(() => new Error('offline')));
      cell.componentRef.setInput('boarCardDef', {
        id: 'cell4',
        title: 'Err',
        ref: { cardId: 'customer' },
      });
      await settle(cell);
      expect(text(cell)).toContain('offline');
      getCard.mockReturnValue(of(queryCard()));
      const retry = [...(cell.nativeElement as HTMLElement).querySelectorAll('ion-button')].find((b) => b.textContent?.includes('Retry')) as HTMLElement;
      retry.click();
      await settle(cell);
      expect(text(cell)).not.toContain('offline');
    });
  });
});
