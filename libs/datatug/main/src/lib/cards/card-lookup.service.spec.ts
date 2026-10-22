import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import type { ProjectCard, ProjectCardBrief } from '@datatug/board-models';
import type { IProjectRef } from '../core/project-context';
import {
  CARD_LOOKUP_DEBOUNCE_MS,
  CardCellSelection,
  CardLookupService,
  bindCellValues,
} from './card-lookup.service';
import { missingRequired } from './card-parameters';
import { ProjectCardsService } from './project-cards.service';

const ref: IProjectRef = { storeId: 'localhost:8989', projectId: 'demo' };

const brief = (
  id: string,
  title: string,
  match: unknown[],
  extra: Partial<ProjectCardBrief> = {},
): ProjectCardBrief => ({
  id,
  title,
  parameters: [
    { id: 'customerId', type: 'integer', isRequired: true, match: match as never },
  ],
  ...extra,
});
const fullCard = (id: string): ProjectCard => ({
  id,
  title: id,
  widget: { name: 'text', data: { markdown: id } },
});
const cell = (
  value: unknown,
  extra: Partial<CardCellSelection> = {},
): CardCellSelection => ({
  identity: { table: 'dbo.Orders', column: 'CustomerID' },
  value,
  ...extra,
});

describe('CardLookupService', () => {
  let service: CardLookupService;
  const listCards = vi.fn();
  const getCard = vi.fn();

  function setup(briefs: ProjectCardBrief[] = []) {
    listCards.mockReset().mockReturnValue(of(briefs));
    getCard.mockReset().mockImplementation((_r: unknown, id: string) => of(fullCard(id)));
    TestBed.configureTestingModule({
      providers: [
        CardLookupService,
        { provide: ProjectCardsService, useValue: { listCards, getCard } },
      ],
    });
    service = TestBed.inject(CardLookupService);
    service.use({
      ref: signal<IProjectRef | undefined>(ref),
      environment: signal<string | undefined>('LOCAL'),
      runContext: signal({ mode: 'view' as const, parameters: {} }),
    });
  }
  const settle = () => vi.advanceTimersByTime(CARD_LOOKUP_DEBOUNCE_MS);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits 150 ms and looks up once for the last of several quick selections', () => {
    setup([brief('customer', 'Customer', [{ column: 'CustomerID' }])]);
    service.select(cell('1'));
    service.select(cell('2'));
    service.select(cell('3'));
    vi.advanceTimersByTime(CARD_LOOKUP_DEBOUNCE_MS - 1);
    expect(listCards).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listCards).toHaveBeenCalledTimes(1);
    expect(listCards).toHaveBeenCalledWith(ref, 'LOCAL');
    expect(service.values()).toEqual({ customerId: 3 });
    expect(service.panelOpen()).toBe(true);
    expect(getCard).toHaveBeenCalledWith(ref, 'customer', 'LOCAL', false);
    expect(service.card()?.id).toBe('customer');
  });

  it('cancels a stale in-flight lookup when a newer cell is selected', () => {
    setup();
    const first = new Subject<ProjectCardBrief[]>();
    const second = new Subject<ProjectCardBrief[]>();
    listCards.mockReturnValueOnce(first).mockReturnValueOnce(second);
    service.select(cell('1'));
    settle();
    expect(first.observed).toBe(true);
    service.select(cell('2'));
    settle();
    expect(first.observed).toBe(false);
    first.next([brief('late', 'Late', [{ column: 'CustomerID' }])]);
    expect(service.matches()).toEqual([]);
    second.next([brief('current', 'Current', [{ column: 'CustomerID' }])]);
    expect(service.active()?.card.id).toBe('current');
    expect(service.values()).toEqual({ customerId: 2 });
  });

  it('skips NULL and empty values at once, and cancels a pending lookup', () => {
    setup([brief('customer', 'Customer', [{ column: 'CustomerID' }])]);
    service.select(cell('1'));
    settle();
    expect(service.panelOpen()).toBe(true);
    for (const blank of [null, undefined, '', '   ']) {
      service.select(cell('7'));
      service.select(cell(blank));
      expect(service.panelOpen()).toBe(false);
      expect(service.matches()).toEqual([]);
      settle();
      expect(service.matches()).toEqual([]);
    }
    // 1 lookup for '1'; none of the pending '7' lookups ran
    expect(listCards).toHaveBeenCalledTimes(1);
  });

  it('ranks matches and omits cards matching only through an optional parameter', () => {
    setup([
      brief('col', 'Column', [{ column: 'CustomerID' }]),
      brief('glob', 'Glob', [{ table: 'dbo.Ord*', column: 'CustomerID' }]),
      brief('exact', 'Exact', [{ table: 'Orders', column: 'CustomerID' }]),
      brief('entity', 'Entity', [{ entity: 'Customer', field: 'Id' }]),
      brief('bad', 'Malformed', [{ entity: 3 }, { column: 'CustomerID' }]),
      {
        id: 'optional',
        title: 'Optional',
        parameters: [
          { id: 'c', type: 'string', isRequired: false, match: [{ column: 'CustomerID' }] },
        ],
      },
    ]);
    service.select(
      cell('1', {
        identity: {
          table: 'dbo.Orders',
          column: 'CustomerID',
          entity: { entity: 'customer', field: 'id' },
        },
      }),
    );
    settle();
    expect(service.matches().map((m) => m.card.id)).toEqual([
      'entity',
      'exact',
      'glob',
      'col',
      'bad',
    ]);
    service.choose('glob');
    expect(service.active()?.card.id).toBe('glob');
    expect(getCard).toHaveBeenLastCalledWith(ref, 'glob', 'LOCAL', false);
    service.choose('nope');
    expect(service.active()?.card.id).toBe('glob');
  });

  it('shows nothing extra when no card matches', () => {
    setup([brief('other', 'Other', [{ column: 'Other' }])]);
    service.select(cell('1'));
    settle();
    expect(service.panelOpen()).toBe(false);
    expect(service.tooltipOpen()).toBe(false);
    expect(service.card()).toBeUndefined();
    expect(getCard).not.toHaveBeenCalled();
  });

  it('treats a failing card list as no match', () => {
    setup();
    listCards.mockReturnValue(throwError(() => new Error('down')));
    service.select(cell('1'));
    settle();
    expect(service.matches()).toEqual([]);
  });

  it('reports a card that cannot be loaded', () => {
    setup([brief('customer', 'Customer', [{ column: 'CustomerID' }])]);
    getCard.mockReturnValue(throwError(() => new Error('Card not found: customer')));
    service.select(cell('1'));
    settle();
    expect(service.cardError()).toBe('Card not found: customer');
    expect(service.card()).toBeUndefined();
    expect(service.cardLoading()).toBe(false);
  });

  it('opens the tooltip for tooltip cards and closes it on a new selection or dismiss', () => {
    setup([brief('customer', 'Customer', [{ column: 'CustomerID' }], { display: 'tooltip' })]);
    service.select(cell('1', { anchor: { x: 10, y: 20 } }));
    settle();
    expect(service.mode()).toBe('tooltip');
    expect(service.tooltipOpen()).toBe(true);
    expect(service.panelOpen()).toBe(false);
    // a newer selection closes it before its own lookup finishes
    service.select(cell('2'));
    expect(service.tooltipOpen()).toBe(false);
    settle();
    expect(service.tooltipOpen()).toBe(true);
    service.dismiss();
    expect(service.tooltipOpen()).toBe(false);
    // a fresh selection opens it again
    service.select(cell('3'));
    settle();
    expect(service.tooltipOpen()).toBe(true);
  });

  it('lets the session override switch between panel and tooltip', () => {
    setup([brief('customer', 'Customer', [{ column: 'CustomerID' }])]);
    service.select(cell('1'));
    settle();
    expect(service.panelOpen()).toBe(true);
    service.setMode('tooltip');
    expect(service.panelOpen()).toBe(false);
    expect(service.tooltipOpen()).toBe(true);
    service.setMode('panel');
    expect(service.panelOpen()).toBe(true);
    // the override outlives the selection
    service.setMode('tooltip');
    service.select(cell('2'));
    settle();
    expect(service.tooltipOpen()).toBe(true);
    service.clear();
    service.setMode('panel');
    expect(service.mode()).toBe('panel');
  });

  it('never shows the answer for cell A under a newer selection B, and drops it when it arrives late', () => {
    setup();
    const a = new Subject<ProjectCardBrief[]>();
    const b = new Subject<ProjectCardBrief[]>();
    listCards.mockReturnValueOnce(a).mockReturnValueOnce(b);
    const cellA = cell('1');
    const cellB = cell('2');
    service.select(cellA);
    settle();
    service.select(cellB);
    // B is selected: A's answer, if it still came, is not applied
    a.next([brief('a-card', 'A', [{ column: 'CustomerID' }])]);
    expect(service.matches()).toEqual([]);
    expect(service.resolvedCell()).toBeUndefined();
    settle();
    b.next([brief('b-card', 'B', [{ column: 'CustomerID' }])]);
    expect(service.resolvedCell()).toBe(cellB);
    expect(service.active()?.card.id).toBe('b-card');
    expect(service.values()).toEqual({ customerId: 2 });
  });

  it('lets a NULL selection win over a lookup already in flight', () => {
    setup();
    const flight = new Subject<ProjectCardBrief[]>();
    listCards.mockReturnValueOnce(flight);
    service.select(cell('1'));
    settle();
    expect(flight.observed).toBe(true);
    service.select(cell(null));
    expect(flight.observed).toBe(false); // cancelled at once, not after the debounce
    flight.next([brief('late', 'Late', [{ column: 'CustomerID' }])]);
    settle();
    expect(service.matches()).toEqual([]);
    expect(service.panelOpen()).toBe(false);
    expect(service.cell()?.value).toBeNull();
  });

  it('clears the previous card before the next one loads and cancels a card still loading for an older cell', () => {
    setup([
      brief('first', 'First', [{ column: 'CustomerID' }]),
      brief('second', 'Second', [{ table: 'Orders', column: 'CustomerID' }]),
    ]);
    const loading = new Subject<ProjectCard>();
    service.select(cell('1'));
    settle();
    expect(service.card()?.id).toBe('second');
    getCard.mockReturnValue(loading);
    service.choose('first');
    expect(service.card()).toBeUndefined();
    expect(service.cardLoading()).toBe(true);
    expect(loading.observed).toBe(true);
    // a newer selection cancels the card read that is still pending
    service.select(cell('2'));
    expect(loading.observed).toBe(false);
    expect(service.cardLoading()).toBe(false);
  });

  it('reads the card again when the card list was refreshed', () => {
    const first = [brief('customer', 'Customer', [{ column: 'CustomerID' }])];
    setup(first);
    service.select(cell('1'));
    settle();
    expect(getCard).toHaveBeenCalledTimes(1);
    // same list: the card stays
    service.select(cell('2'));
    settle();
    expect(getCard).toHaveBeenCalledTimes(1);
    // a refreshed list brings new brief objects: the card is read again
    listCards.mockReturnValue(of([brief('customer', 'Customer', [{ column: 'CustomerID' }])]));
    service.select(cell('3'));
    settle();
    expect(getCard).toHaveBeenCalledTimes(2);
    // ...past the card cache, so an edited card is what shows
    expect(getCard).toHaveBeenLastCalledWith(ref, 'customer', 'LOCAL', true);
  });

  it('shows every card as a popover while the page has no room beside its grid', () => {
    setup([brief('customer', 'Customer', [{ column: 'CustomerID' }], { display: 'panel' })]);
    service.select(cell('1'));
    settle();
    expect(service.panelOpen()).toBe(true);
    service.compact.set(true);
    expect(service.mode()).toBe('tooltip');
    expect(service.panelOpen()).toBe(false);
    expect(service.tooltipOpen()).toBe(true);
    // the session override cannot force a panel where there is no room
    service.setMode('panel');
    expect(service.tooltipOpen()).toBe(true);
    service.compact.set(false);
    expect(service.panelOpen()).toBe(true);
  });

  it('does nothing without a project', () => {
    setup([brief('customer', 'Customer', [{ column: 'CustomerID' }])]);
    service.use({
      ref: signal<IProjectRef | undefined>(undefined),
      environment: signal<string | undefined>(undefined),
      runContext: signal({ mode: 'view' as const, parameters: {} }),
    });
    service.select(cell('1'));
    settle();
    expect(listCards).not.toHaveBeenCalled();
    expect(service.matches()).toEqual([]);
  });
});

describe('bindCellValues', () => {
  const match = (parameters: ProjectCardBrief['parameters']) => ({
    card: { id: 'c', title: 'C', parameters },
    parameterId: 'customerId',
    rank: 4,
  });

  it('binds the cell value to the matched parameter, numeric for numeric types', () => {
    expect(bindCellValues(match([{ id: 'customerId', type: 'integer' }]), cell('42'))).toEqual({
      customerId: 42,
    });
    expect(bindCellValues(match([{ id: 'customerId', type: 'string' }]), cell('00042'))).toEqual({
      customerId: '00042',
    });
    expect(bindCellValues(match([{ id: 'customerId', type: 'number' }]), cell('abc'))).toEqual({
      customerId: 'abc',
    });
    expect(bindCellValues(undefined, cell('1'))).toEqual({});
    expect(bindCellValues(match([]), undefined)).toEqual({});
  });

  it('hands the selected row to a declared record parameter, not to recordsets', () => {
    const row = { CustomerID: 'ALFKI', Name: 'Alfreds' };
    expect(
      bindCellValues(
        match([
          { id: 'customerId', type: 'string' },
          { id: 'row', type: 'record' },
          { id: 'rows', type: 'recordset' },
        ]),
        cell('ALFKI', { row }),
      ),
    ).toEqual({ customerId: 'ALFKI', row });
  });

  it('leaves an input the cell cannot supply missing, so the card asks for it', () => {
    const full: ProjectCard = {
      id: 'c',
      title: 'C',
      parameters: [
        { id: 'customerId', type: 'string', isRequired: true },
        { id: 'year', type: 'integer', isRequired: true },
      ],
      widget: { name: 'text', data: { markdown: '' } },
    };
    const values = bindCellValues(
      match([
        { id: 'customerId', type: 'string', isRequired: true },
        { id: 'year', type: 'integer', isRequired: true },
      ]),
      cell('ALFKI'),
    );
    expect(missingRequired(full, values).map((p) => p.id)).toEqual(['year']);
  });
});
