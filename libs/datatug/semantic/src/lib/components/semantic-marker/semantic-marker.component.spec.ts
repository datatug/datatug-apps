import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SemanticMarkerComponent } from './semantic-marker.component';

describe('SemanticMarkerComponent', () => {
  let fixture: ComponentFixture<SemanticMarkerComponent>;

  async function createWith(provenance: 'declared' | 'inferred') {
    await TestBed.configureTestingModule({
      imports: [SemanticMarkerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SemanticMarkerComponent);
    fixture.componentRef.setInput('entity', 'Customer');
    fixture.componentRef.setInput('field', 'ID');
    fixture.componentRef.setInput('provenance', provenance);
    fixture.detectChanges();
  }

  it('AC:mapped-columns-marked — declared mapping renders the "entity.field · declared" tooltip', async () => {
    await createWith('declared');
    const icon: HTMLElement = fixture.nativeElement.querySelector('ion-icon');
    expect(icon.getAttribute('title')).toBe('Customer.ID · declared');
    expect(icon.getAttribute('aria-label')).toBe('Customer.ID · declared');
    expect(icon.classList.contains('semantic-marker--inferred')).toBe(false);
  });

  it('AC:inferred-mapping-labelled — inferred mapping renders the "inferred" tooltip and styling', async () => {
    await createWith('inferred');
    const icon: HTMLElement = fixture.nativeElement.querySelector('ion-icon');
    expect(icon.getAttribute('title')).toBe('Customer.ID · inferred');
    expect(icon.classList.contains('semantic-marker--inferred')).toBe(true);
  });
});
