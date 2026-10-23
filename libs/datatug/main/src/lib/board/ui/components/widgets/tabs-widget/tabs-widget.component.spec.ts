import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TabsWidgetComponent } from './tabs-widget.component';

describe('TabsWidgetComponent', () => {
  let component: TabsWidgetComponent;
  let fixture: ComponentFixture<TabsWidgetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabsWidgetComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(TabsWidgetComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TabsWidgetComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});


describe('TabsWidgetComponent accessible relationships', () => {
  it('associates the selected tab and panel with stable, distinct instance IDs', async () => {
    await TestBed.configureTestingModule({ imports: [TabsWidgetComponent] }).compileComponents();
    const create = () => {
      const fixture = TestBed.createComponent(TabsWidgetComponent);
      fixture.componentRef.setInput('boardWidgetComponent', TabsWidgetComponent);
      fixture.componentRef.setInput('resultSnapshot', signal(undefined));
      fixture.componentRef.setInput('tabsWidgetDef', { tabs: [{ id: 'one', title: 'First' }, { id: 'two', title: 'Second' }] });
      fixture.detectChanges();
      return fixture;
    };
    const first = create(), second = create();
    const panel = first.nativeElement.querySelector('[role=tabpanel]') as HTMLElement;
    const before = panel.id;
    expect(panel.getAttribute('aria-labelledby')).toBe(first.componentInstance.tabDOMID('id:one'));
    for (const tab of first.nativeElement.querySelectorAll('ion-segment-button')) expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(second.nativeElement.querySelector('[role=tabpanel]').id).not.toBe(panel.id);
    first.componentInstance.select('id:two');
    await first.whenStable();
    expect(panel.id).toBe(before);
    expect(panel.getAttribute('aria-labelledby')).toBe(first.componentInstance.tabDOMID('id:two'));
  });
});

describe('TabsWidgetComponent narrow strip', () => {
  it('scrolls the newly selected tab into view after it renders', async () => {
    await TestBed.configureTestingModule({ imports: [TabsWidgetComponent] }).compileComponents();
    const fixture = TestBed.createComponent(TabsWidgetComponent);
    fixture.componentRef.setInput('boardWidgetComponent', TabsWidgetComponent);
    fixture.componentRef.setInput('resultSnapshot', signal(undefined));
    fixture.componentRef.setInput('tabsWidgetDef', { tabs: [{ id: 'one', title: 'First' }, { id: 'two', title: 'Second' }] });
    fixture.detectChanges();
    await fixture.whenStable();
    const segment = fixture.nativeElement.querySelector('ion-segment') as HTMLElement;
    const second = fixture.nativeElement.querySelectorAll('ion-segment-button')[1] as HTMLElement;
    const box = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(segment, 'scrollWidth', { value: 974 });
    Object.defineProperty(segment, 'clientWidth', { value: 355 });
    segment.getBoundingClientRect = () => box(10, 355);
    second.getBoundingClientRect = () => box(318, 311);
    const scrollTo = vi.fn();
    segment.scrollTo = scrollTo as typeof segment.scrollTo;
    fixture.componentInstance.select('id:two');
    await fixture.whenStable();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(scrollTo).toHaveBeenCalledWith({ left: segment.scrollLeft + 264, behavior: 'instant' });
  });
});
