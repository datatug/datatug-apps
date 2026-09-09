import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResultLimitation } from '../../models/models';
import { LimitationHeaderComponent } from './limitation-header.component';

describe('LimitationHeaderComponent', () => {
  let fixture: ComponentFixture<LimitationHeaderComponent>;

  async function createWith(limitations: readonly ResultLimitation[]) {
    await TestBed.configureTestingModule({
      imports: [LimitationHeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(LimitationHeaderComponent);
    fixture.componentRef.setInput('limitations', limitations);
    fixture.detectChanges();
  }

  function lineTexts(): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.limitation-header__line'),
    ).map((el) => (el as HTMLElement).textContent?.trim().replace(/\s+/g, ' '));
  }

  it('renders nothing when there are no limitations', async () => {
    await createWith([]);
    expect(fixture.nativeElement.querySelector('.limitation-header')).toBeNull();
  });

  it('AC:restricted-rows-and-columns — renders "Limited by policy X: rows filtered, N column(s) hidden"', async () => {
    await createWith([
      {
        policy: 'customers-support',
        rowsFiltered: true,
        hiddenColumns: ['Email'],
      },
    ]);
    const texts = lineTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(
      'Limited by policy customers-support: rows filtered, 1 column hidden',
    );
  });

  it('pluralizes "columns" when more than one is hidden', async () => {
    await createWith([
      { policy: 'customers-support', hiddenColumns: ['Email', 'Phone'] },
    ]);
    expect(lineTexts()[0]).toContain('2 columns hidden');
  });

  it('AC:native-sql-labelled — renders the native-SQL note as its own line', async () => {
    await createWith([{ nativeSqlPoliciesNotApplied: true }]);
    const texts = lineTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('row/column policies not applied to native SQL');
  });

  it('renders both a policy line and the native-SQL note from the same limitation', async () => {
    await createWith([
      {
        policy: 'customers-support',
        rowsFiltered: true,
        nativeSqlPoliciesNotApplied: true,
      },
    ]);
    const texts = lineTexts();
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('Limited by policy customers-support: rows filtered');
    expect(texts[1]).toContain('row/column policies not applied to native SQL');
  });
});
