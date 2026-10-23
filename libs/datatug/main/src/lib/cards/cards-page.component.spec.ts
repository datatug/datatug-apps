import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import type { ProjectCardBrief } from '@datatug/board-models';
import { CardsPageComponent } from './cards-page.component';
import { allText, configureCardsPage, CardsHarness } from './cards-test-harness.spec-helper';

const customer: ProjectCardBrief = {
  id: 'customer',
  title: 'Customer',
  description: 'One customer with the latest orders',
  display: 'tooltip',
  parameters: [
    {
      id: 'customerId',
      type: 'string',
      isRequired: true,
      match: [{ entity: 'Customer', field: 'CustomerID' }],
    },
  ],
};

describe('CardsPageComponent', () => {
  let fixture: ComponentFixture<CardsPageComponent>;
  let harness: CardsHarness;
  const text = () => allText(fixture.nativeElement);

  async function create(options: Parameters<typeof configureCardsPage>[1] = {}) {
    harness = configureCardsPage(CardsPageComponent, options);
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(CardsPageComponent);
    fixture.detectChanges();
  }
  const settle = async () => {
    await fixture.whenStable();
  };

  it('shows loading, then the cards with parameter chips and display mode (no manual detectChanges after the emit)', async () => {
    const list = new Subject<ProjectCardBrief[]>();
    await create({ service: { listCards: vi.fn(() => list) } });
    expect(fixture.nativeElement.querySelector('[aria-label="Loading cards"]')).not.toBeNull();
    list.next([customer, { id: 'plain', title: 'Plain' }]);
    await settle();
    const rows = fixture.nativeElement.querySelectorAll('ion-item');
    expect(rows).toHaveLength(2);
    expect(text()).toContain('Customer');
    expect(text()).toContain('One customer with the latest orders');
    expect(text()).toContain('customerId ← Customer.CustomerID');
    expect(text()).toContain('Tooltip');
    expect(text()).toContain('Panel');
    expect(fixture.nativeElement.querySelector('[aria-label="Loading cards"]')).toBeNull();
  });

  it('links each card to its page and offers New card', async () => {
    await create({ service: { listCards: vi.fn(() => of([customer])) } });
    await settle();
    expect(harness.router.parseUrl).toHaveBeenCalledWith(
      expect.stringContaining('/card/customer'),
    );
    expect(harness.router.parseUrl).toHaveBeenCalledWith(
      expect.stringContaining('/cards/new'),
    );
    expect(text()).toContain('New card');
  });

  it('explains cards in the empty state and offers New card', async () => {
    await create({ service: { listCards: vi.fn(() => of([])) } });
    await settle();
    expect(text()).toContain('No cards yet');
    expect(text()).toContain('A card shows one thing about a record');
    const buttons = [...fixture.nativeElement.querySelectorAll('ion-button')].map(
      (b) => (b as HTMLElement).textContent?.trim(),
    );
    expect(buttons.filter((b) => b === 'New card').length).toBeGreaterThanOrEqual(1);
  });

  it('hides creating in a read-only project', async () => {
    await create({ canWrite: false, service: { listCards: vi.fn(() => of([])) } });
    await settle();
    expect(text()).not.toContain('New card');
    expect(text()).toContain('read-only');
    harness.service['listCards'].mockReturnValue(of([customer]));
  });

  it('keeps listing and says read-only for a project that cannot write', async () => {
    await create({ canWrite: false, service: { listCards: vi.fn(() => of([customer])) } });
    await settle();
    expect(text()).toContain('Customer');
    expect(text()).not.toContain('New card');
    expect(text()).toContain('read-only');
  });

  it('shows a load error with Retry that reloads past the cache', async () => {
    const listCards = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('Agent unreachable')))
      .mockReturnValue(of([customer]));
    await create({ service: { listCards } });
    await settle();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Agent unreachable',
    );
    (fixture.nativeElement.querySelector('ion-button') as HTMLElement).click();
    const retry = [...fixture.nativeElement.querySelectorAll('ion-button')].find(
      (b) => (b as HTMLElement).textContent?.trim() === 'Retry',
    ) as HTMLElement;
    retry.click();
    await settle();
    fixture.detectChanges();
    expect(listCards).toHaveBeenLastCalledWith(expect.anything(), undefined, true);
    expect(text()).toContain('Customer');
  });

  it('asks for an environment in a shared project', async () => {
    await create({
      ref: { storeId: 'firestore', spaceID: 'space', projectId: 'training' },
      service: { listCards: vi.fn(() => of([])) },
    });
    await settle();
    expect(text()).toContain('Choose an environment');
    expect(harness.service['listCards']).not.toHaveBeenCalled();
  });

  it('filters a long list', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, title: `Card ${i}` }));
    await create({ service: { listCards: vi.fn(() => of(many)) } });
    await settle();
    const search = fixture.nativeElement.querySelector('ion-searchbar') as HTMLElement;
    expect(search).not.toBeNull();
    search.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'card 7' } }));
    await settle();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('ion-item')).toHaveLength(1);
    search.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'zzz' } }));
    fixture.detectChanges();
    expect(fixture.nativeElement.innerHTML).toContain('No card matches');
  });

  it('shows the cards as saved elsewhere when the page is entered again', async () => {
    const listCards = vi.fn(() => of([customer]));
    await create({ service: { listCards } });
    await settle();
    fixture.componentInstance.ionViewWillEnter();
    await settle();
    expect(listCards).toHaveBeenCalledTimes(2);
    expect(listCards).toHaveBeenLastCalledWith(expect.anything(), undefined, true);
  });
});
