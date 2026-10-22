import { Component, input, output, signal } from '@angular/core';
import { IonPopover } from '@ionic/angular';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject, of } from 'rxjs';
import type {
  CardMatch,
  ProjectCard,
  ProjectCardBrief,
} from '@datatug/board-models';
import { CardLookupService } from './card-lookup.service';
import { CellCardPanelComponent } from './cell-card-panel.component';
import { CellCardPopoverComponent } from './cell-card-popover.component';
import { ProjectCardViewComponent } from './project-card-view.component';
import { ResultCellCardsComponent } from './result-cell-cards.component';
import { ProjectCardsService } from './project-cards.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AgentContextService } from '@sneat/datatug-semantic';

@Component({
  selector: 'sneat-datatug-project-card-view',
  template: '<p class="view">{{ card().title }} {{ json() }}</p>',
  providers: [{ provide: ProjectCardViewComponent, useExisting: ViewStub }],
})
class ViewStub {
  readonly card = input.required<ProjectCard>();
  readonly parameterValues = input<Record<string, unknown>>({});
  readonly projectRef = input<unknown>();
  readonly environment = input<string>();
  readonly boardContext = input<unknown>();
  readonly cache = input<unknown>();
  refresh = vi.fn();
  json = () => JSON.stringify(this.parameterValues());
}

/** Stands in for ion-popover, which needs Ionic's framework delegate to present. */
// eslint-disable-next-line @angular-eslint/component-selector
@Component({ selector: 'ion-popover', template: '' })
class PopoverStub {
  readonly isOpen = input(false);
  readonly event = input<MouseEvent | undefined>(undefined);
  readonly reference = input('');
  readonly side = input('');
  readonly alignment = input('');
  readonly size = input('');
  readonly cssClass = input('');
  readonly keepContentsMounted = input(true);
  readonly dismissOnSelect = input(true);
  readonly focusTrap = input(true);
  readonly showBackdrop = input(true);
  readonly backdropDismiss = input(true);
  readonly didDismiss = output<void>();
}

const match = (id: string, title: string): CardMatch => ({
  card: { id, title } as ProjectCardBrief,
  parameterId: 'customerId',
  rank: 4,
});
const card = (id: string, tabs = 1): ProjectCard => ({
  id,
  title: id.toUpperCase(),
  widget: {
    name: 'tabs',
    data: {
      tabs: Array.from({ length: tabs }, (_, i) => ({
        title: `Tab ${i + 1}`,
        widgets: [],
      })),
    },
  },
});

function fakeLookup() {
  const panelOpen = signal(true);
  const tooltipOpen = signal(false);
  const matches = signal<readonly CardMatch[]>([match('customer', 'Customer')]);
  const active = signal<CardMatch | undefined>(matches()[0]);
  const lookup = {
    panelOpen,
    tooltipOpen,
    matches,
    active,
    card: signal<ProjectCard | undefined>(card('customer')),
    cardError: signal<string | undefined>(undefined),
    resolvedCell: signal({ identity: { column: 'CustomerID' }, value: 'ALFKI' }),
    cell: signal<{ anchor?: { x: number; y: number } } | undefined>({ anchor: { x: 12, y: 34 } }),
    values: signal({ customerId: 'ALFKI' }),
    projectRef: signal({ storeId: 's', projectId: 'p' }),
    environment: signal<string | undefined>('LOCAL'),
    runContext: signal({ mode: 'view', parameters: {} }),
    choose: vi.fn(),
    setMode: vi.fn(),
    dismiss: vi.fn(),
    use: vi.fn(),
    select: vi.fn(),
    clear: vi.fn(),
  };
  return lookup;
}

describe('CellCardPanelComponent', () => {
  let lookup: ReturnType<typeof fakeLookup>;
  let fixture: ComponentFixture<CellCardPanelComponent>;
  const qn = (s: string) => fixture.nativeElement.querySelector(s) as HTMLElement | null;
  const q = (s: string): HTMLElement => {
    const found = qn(s);
    if (!found) throw new Error(`Missing ${s}`);
    return found;
  };
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    lookup = fakeLookup();
    await TestBed.configureTestingModule({
      imports: [CellCardPanelComponent],
      providers: [{ provide: CardLookupService, useValue: lookup }],
    })
      .overrideComponent(CellCardPanelComponent, {
        remove: { imports: [ProjectCardViewComponent] },
        add: { imports: [ViewStub] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(CellCardPanelComponent);
    fixture.detectChanges();
  });

  it('shows the card with the values the cell supplied, and what it was opened for', () => {
    expect(qn('.view')?.textContent).toContain('CUSTOMER');
    expect(qn('.view')?.textContent).toContain('{"customerId":"ALFKI"}');
    expect(qn('.selected')?.textContent).toContain('CustomerID · ALFKI');
    expect(qn('ion-segment')).toBeNull();
  });

  it('shows nothing when no card is open', async () => {
    lookup.panelOpen.set(false);
    await settle();
    expect(qn('.panel')).toBeNull();
  });

  it('lists several matches as tabs in rank order and switches on selection', async () => {
    lookup.matches.set([match('a', 'A'), match('b', 'B'), match('c', 'C')]);
    await settle();
    const segment = q('ion-segment');
    expect(
      [...segment.querySelectorAll('ion-segment-button')].map((b) => (b as never as { value: string }).value),
    ).toEqual(['a', 'b', 'c']);
    segment.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'b' } }));
    expect(lookup.choose).toHaveBeenCalledWith('b');
  });

  it('uses a select for more than three matches', async () => {
    lookup.matches.set([match('a', 'A'), match('b', 'B'), match('c', 'C'), match('d', 'D'), match('e', 'E')]);
    await settle();
    expect(qn('ion-segment')).toBeNull();
    const select = q('ion-select');
    expect(select.querySelectorAll('ion-select-option')).toHaveLength(5);
    select.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'e' } }));
    expect(lookup.choose).toHaveBeenCalledWith('e');
  });

  it('refreshes the card, closes, and hands over to a tooltip for the session', async () => {
    const view = fixture.debugElement.query(By.directive(ViewStub)).componentInstance as ViewStub;
    q('[data-action="refresh"]').click();
    expect(view.refresh).toHaveBeenCalledTimes(1);
    q('[data-action="as-tooltip"]').click();
    expect(lookup.setMode).toHaveBeenCalledWith('tooltip');
    q('[data-action="close"]').click();
    expect(lookup.dismiss).toHaveBeenCalled();
  });

  it('shows a loading state, then the error of a card that cannot load', async () => {
    lookup.card.set(undefined);
    await settle();
    expect(qn('[aria-label="Loading card"]')).not.toBeNull();
    lookup.cardError.set('Card not found: customer');
    await settle();
    expect(qn('[role="alert"]')?.textContent).toContain('Card not found');
  });
});

describe('CellCardPopoverComponent', () => {
  let lookup: ReturnType<typeof fakeLookup>;
  let fixture: ComponentFixture<CellCardPopoverComponent>;
  const popover = () =>
    fixture.debugElement.query(By.directive(PopoverStub)).componentInstance as PopoverStub;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    lookup = fakeLookup();
    lookup.tooltipOpen.set(true);
    lookup.card.set(card('customer', 2));
    await TestBed.configureTestingModule({
      imports: [CellCardPopoverComponent],
      providers: [{ provide: CardLookupService, useValue: lookup }],
    })
      .overrideComponent(CellCardPopoverComponent, {
        remove: { imports: [ProjectCardViewComponent, IonPopover] },
        add: { imports: [ViewStub, PopoverStub] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(CellCardPopoverComponent);
    fixture.detectChanges();
  });

  it('opens over the selected cell when a tooltip card matches', async () => {
    expect(popover().isOpen()).toBe(true);
    expect(popover().reference()).toBe('event');
    expect(popover().event()?.clientX).toBe(12);
    expect(popover().event()?.clientY).toBe(34);
    lookup.tooltipOpen.set(false);
    await settle();
    expect(popover().isOpen()).toBe(false);
  });

  it('shows only the first tab', () => {
    const compact = (fixture.componentInstance as never as { compact: () => ProjectCard }).compact();
    expect(((compact.widget as { data: unknown }).data as { tabs: unknown[] }).tabs).toHaveLength(1);
    lookup.card.set(undefined);
    expect((fixture.componentInstance as never as { compact: () => unknown }).compact()).toBeUndefined();
  });

  it('closes on Escape and when the popover is dismissed, only while open', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(lookup.dismiss).toHaveBeenCalledTimes(1);
    popover().didDismiss.emit();
    expect(lookup.dismiss).toHaveBeenCalledTimes(2);
    lookup.tooltipOpen.set(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(lookup.dismiss).toHaveBeenCalledTimes(2);
  });

  it('opens in panel', () => {
    (fixture.componentInstance as never as { openInPanel: () => void }).openInPanel();
    expect(lookup.setMode).toHaveBeenCalledWith('panel');
  });

  it('has no anchor without a position', async () => {
    lookup.cell.set({});
    await settle();
    expect(popover().event()).toBeUndefined();
  });
});

describe('ResultCellCardsComponent', () => {
  it('owns a lookup of its own and forwards focused cells to it', async () => {
    const listCards = vi.fn(() => of<ProjectCardBrief[]>([]));
    await TestBed.configureTestingModule({
      imports: [ResultCellCardsComponent],
      providers: [
        { provide: ProjectCardsService, useValue: { listCards, getCard: vi.fn(), canWrite: vi.fn(), canDelete: vi.fn() } },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: new Subject(),
            currentEnv: of(undefined),
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: {} },
        { provide: AgentContextService, useValue: { contextFor: vi.fn() } },
      ],
    })
      .overrideComponent(ResultCellCardsComponent, {
        set: { imports: [], template: '' },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(ResultCellCardsComponent);
    fixture.detectChanges();
    const lookup = (fixture.componentInstance as never as { lookup: CardLookupService }).lookup;
    const select = vi.spyOn(lookup, 'select');
    const cell = { identity: { column: 'CustomerID' }, value: 'ALFKI' };
    fixture.componentInstance.focusCell(cell);
    expect(select).toHaveBeenCalledWith(cell);
    fixture.componentInstance.clear();
    expect(select).toHaveBeenLastCalledWith(undefined);
  });
});
