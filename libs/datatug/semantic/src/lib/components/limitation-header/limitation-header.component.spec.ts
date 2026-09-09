import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ExecutionProfile, Limitation } from '../../../contract/types';
import { LimitationHeaderComponent } from './limitation-header.component';

describe('LimitationHeaderComponent', () => {
  let fixture: ComponentFixture<LimitationHeaderComponent>;

  async function createWith(
    limitations: readonly Limitation[],
    executionProfile?: ExecutionProfile,
  ) {
    await TestBed.configureTestingModule({
      imports: [LimitationHeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(LimitationHeaderComponent);
    fixture.componentRef.setInput('limitations', limitations);
    if (executionProfile) {
      fixture.componentRef.setInput('executionProfile', executionProfile);
    }
    fixture.detectChanges();
  }

  function lineTexts(): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.limitation-header__line'),
    ).map((el) => (el as HTMLElement).textContent?.trim().replace(/\s+/g, ' '));
  }

  it('renders nothing when there are no limitations and no opaque-privileged profile', async () => {
    await createWith([]);
    expect(fixture.nativeElement.querySelector('.limitation-header')).toBeNull();
  });

  it('AC:restricted-rows-and-columns — renders "Limited by policy X: rows filtered, N column(s) hidden"', async () => {
    await createWith([
      { policy: 'customers-support', rowsFiltered: true, hiddenColumns: ['Email'] },
    ]);
    const texts = lineTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(
      'Limited by policy customers-support: rows filtered, 1 column hidden',
    );
  });

  it('pluralizes "columns" when more than one is hidden', async () => {
    await createWith([
      { policy: 'customers-support', rowsFiltered: false, hiddenColumns: ['Email', 'Phone'] },
    ]);
    expect(lineTexts()[0]).toContain('2 columns hidden');
  });

  it('a protected name stays hidden behind an empty hiddenColumns list and a generic policy label', async () => {
    await createWith([{ policy: 'customers-support', rowsFiltered: true, hiddenColumns: [] }]);
    const texts = lineTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('Limited by policy customers-support: rows filtered');
    expect(texts[0]).not.toContain('column');
  });

  it('AC:native-sql-labelled — opaque-privileged executionProfile renders its own line', async () => {
    await createWith([], 'opaque-privileged');
    const texts = lineTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('row/column enforcement does not apply');
  });

  it('renders both a policy line and the opaque-privileged note together', async () => {
    await createWith(
      [{ policy: 'customers-support', rowsFiltered: true, hiddenColumns: [] }],
      'opaque-privileged',
    );
    const texts = lineTexts();
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('Limited by policy customers-support: rows filtered');
    expect(texts[1]).toContain('row/column enforcement does not apply');
  });

  it('protected executionProfile does not render the opaque-privileged note', async () => {
    await createWith([], 'protected');
    expect(fixture.nativeElement.querySelector('.limitation-header')).toBeNull();
  });
});
