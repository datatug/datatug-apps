import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  TemplateRef,
  input,
  provideZonelessChangeDetection,
  viewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProjectCardsService } from '../../../../cards/project-cards.service';
import {
  BoardCardComponent,
  BoardCardTabService,
} from './board-card.component';
import { BoardWidgetComponent } from '../board-widget/board-widget.component';

@Component({
  selector: 'sneat-datatug-board-widget',
  template:
    '<ng-template #actions><button type="button">Run actual query</button></ng-template>',
})
class WidgetStub {
  readonly embedded = input(false);
  readonly cardTitle = input<string>();
  readonly level = input<unknown>();
  readonly cardTab = input<unknown>();
  readonly widgetDef = input<unknown>();
  readonly boardContext = input<unknown>();
  readonly projectRef = input<unknown>();
  readonly boardId = input<unknown>();
  readonly cardId = input<unknown>();
  readonly readBoardForRun = input<unknown>();
  readonly cardMode = input(false);
  readonly resultCache = input<unknown>();
  readonly headerActions = viewChild<TemplateRef<unknown>>('actions');
  displayTitle() {
    return this.cardTitle() || 'Actual query';
  }
  hasHeaderActions() {
    return true;
  }
}

const getCard = vi.fn();

describe('BoardCardComponent', () => {
  let component: BoardCardComponent;
  let fixture: ComponentFixture<BoardCardComponent>;
  beforeEach(async () => {
    getCard.mockReset().mockReturnValue(of({ id: 'customer', title: 'Customer', widget: { name: 'text', data: { markdown: '' } } }));
    await TestBed.configureTestingModule({
      imports: [BoardCardComponent],
      providers: [
        BoardCardTabService,
        provideZonelessChangeDetection(),
        { provide: ProjectCardsService, useValue: { getCard, invalidate: vi.fn() } },
      ],
    })
      .overrideComponent(BoardCardComponent, {
        remove: { imports: [BoardWidgetComponent] },
        add: { imports: [WidgetStub], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(BoardCardComponent);
    component = fixture.componentInstance;
  });
  it('uses one light header with the actual card title and the owning widget actions at the end', async () => {
    fixture.componentRef.setInput('boarCardDef', {
      id: 'actual-card',
      title: 'Dispatch milestones',
      widget: { name: 'SQL', data: { sql: { queryId: 'actual-query' } } },
    });
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelectorAll('ion-card-header'),
    ).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector('ion-card-title').textContent,
    ).toContain('Dispatch milestones');
    expect(
      fixture.nativeElement.querySelector('ion-toolbar').getAttribute('color'),
    ).toBe('light');
    const action = fixture.nativeElement.querySelector(
      'ion-buttons[slot="end"] button',
    ) as HTMLButtonElement;
    expect(action.textContent).toBe('Run actual query');
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(1);
    fixture.componentRef.setInput('boarCardDef', {
      id: 'actual-card',
      widget: { name: 'SQL', data: { sql: { queryId: 'actual-query' } } },
    });
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('ion-card-title').textContent,
    ).toContain('Actual query');
  });

  it('renders the body only when bare, with no card and no header (no card in a card)', async () => {
    fixture.componentRef.setInput('bare', true);
    fixture.componentRef.setInput('cardMode', true);
    fixture.componentRef.setInput('boarCardDef', {
      id: 'actual-card',
      title: 'Dispatch milestones',
      widget: { name: 'SQL', data: { sql: { queryId: 'actual-query' } } },
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ion-card')).toBeNull();
    expect(el.querySelector('ion-card-header')).toBeNull();
    expect(el.querySelector('sneat-datatug-board-widget')).not.toBeNull();
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders a referenced card body-only inside one card whose header carries the referenced title', async () => {
    fixture.componentRef.setInput('boarCardDef', { id: 'cell', title: '', ref: { cardId: 'customer' } });
    fixture.componentRef.setInput('projectRef', { storeId: 's', projectId: 'p' });
    fixture.componentRef.setInput('boardContext', { mode: 'view', environment: 'dev', parameters: {} });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('ion-card')).toHaveLength(1);
    expect(el.querySelectorAll('ion-card-header')).toHaveLength(1);
    expect(el.querySelector('ion-card-title')?.textContent).toContain('Customer');
    expect(el.querySelectorAll('sneat-datatug-board-card')).toHaveLength(1);
  });

  it('loads a referenced card again only when the environment changes, not for every parameter change', async () => {
    const project = { storeId: 's', projectId: 'p' };
    fixture.componentRef.setInput('boarCardDef', { id: 'cell', title: '', ref: { cardId: 'customer' } });
    fixture.componentRef.setInput('projectRef', project);
    fixture.componentRef.setInput('boardContext', { mode: 'view', environment: 'dev', parameters: {} });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getCard).toHaveBeenCalledTimes(1);
    expect(getCard).toHaveBeenCalledWith(project, 'customer', 'dev');
    expect(component.refState().kind).toBe('ready');
    fixture.componentRef.setInput('boardContext', {
      mode: 'view',
      environment: 'dev',
      parameters: { customerId: { type: 'string', value: 'ALFKI' } },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getCard).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('boardContext', { mode: 'view', environment: 'prod', parameters: {} });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getCard).toHaveBeenCalledTimes(2);
    expect(getCard).toHaveBeenLastCalledWith(project, 'customer', 'prod');
  });
});
