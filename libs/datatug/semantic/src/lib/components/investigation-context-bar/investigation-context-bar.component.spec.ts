import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InvestigationContextService } from '../../services/investigation-context.service';
import { InvestigationContextBarComponent } from './investigation-context-bar.component';

describe('InvestigationContextBarComponent', () => {
  let fixture: ComponentFixture<InvestigationContextBarComponent>;
  let context: InvestigationContextService;

  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [InvestigationContextBarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(InvestigationContextBarComponent);
    context = TestBed.inject(InvestigationContextService);
    // This bar component only reads/mutates InvestigationContextService (it doesn't
    // track project/environment/securityContextId itself — a host page's own scope
    // wiring, e.g. ContextPanelComponent's effect, owns setScope() in the real app), so
    // these specs set a scope directly to exercise the same basket the chips render.
    context.setScope({ project: 'p1', environment: 'local', securityContextId: 'sc-1' });
  });

  it('renders nothing when the context is empty', () => {
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.investigation-context-bar'),
    ).toBeNull();
  });

  it('renders a chip per context item, labelled from the item', () => {
    context.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    fixture.detectChanges();

    const chips = fixture.nativeElement.querySelectorAll('ion-chip');
    expect(chips.length).toBe(1);
    // happy-dom's Element#textContent does not reflect projected content whose
    // *only* child is a single Angular interpolation (verified against innerHTML,
    // which does show it) — assert on innerHTML here rather than textContent.
    expect((chips[0] as HTMLElement).innerHTML).toContain('Customer.ID = 5');
  });

  it('J3 — tapping the chip disables it (reversibly) via the service', () => {
    const item = context.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    fixture.detectChanges();

    const chip: HTMLElement = fixture.nativeElement.querySelector('ion-chip');
    chip.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(context.items().find((i) => i.id === item.id)?.enabled).toBe(false);

    chip.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(context.items().find((i) => i.id === item.id)?.enabled).toBe(true);
  });

  it('tapping the close icon removes the item without toggling it', () => {
    context.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    fixture.detectChanges();

    const closeIcon: HTMLElement = fixture.nativeElement.querySelector(
      'ion-chip ion-icon[name="close"]',
    );
    closeIcon.dispatchEvent(new Event('click', { bubbles: true }));
    fixture.detectChanges();

    expect(context.items()).toEqual([]);
  });
});
