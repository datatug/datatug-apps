import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  TemplateRef,
  input,
  provideZonelessChangeDetection,
  viewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
  readonly headerActions = viewChild<TemplateRef<unknown>>('actions');
  displayTitle() {
    return this.cardTitle() || 'Actual query';
  }
  hasHeaderActions() {
    return true;
  }
}

describe('BoardCardComponent', () => {
  let fixture: ComponentFixture<BoardCardComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardCardComponent],
      providers: [BoardCardTabService, provideZonelessChangeDetection()],
    })
      .overrideComponent(BoardCardComponent, {
        remove: { imports: [BoardWidgetComponent] },
        add: { imports: [WidgetStub], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(BoardCardComponent);
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
});
