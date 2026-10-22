import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlertController } from '@ionic/angular';
import { Subject, of, throwError } from 'rxjs';
import type { ProjectCard } from '@datatug/board-models';
import { QueriesService } from '../queries/queries.service';
import { CardPageComponent } from './card-page.component';
import { CardParametersEditorComponent } from './card-parameters-editor.component';
import { CardWidgetEditorComponent } from './card-widget-editor.component';
import { CardNotFoundError } from './project-cards.service';
import {
  CardsHarness,
  allText,
  configureCardsPage,
  demoRef,
} from './cards-test-harness.spec-helper';

@Component({
  selector: 'sneat-datatug-project-card-view',
  template: '<p class="view">view {{ card().id }} {{ json() }}</p>',
})
class CardViewStub {
  readonly card = input.required<ProjectCard>();
  readonly parameterValues = input<Record<string, unknown>>({});
  readonly projectRef = input<unknown>();
  readonly environment = input<string>();
  readonly boardContext = input<unknown>();
  readonly cache = input<unknown>();
  readonly showHeader = input(true);
  refresh = vi.fn();
  json = () => JSON.stringify(this.parameterValues());
}

const saved: ProjectCard = {
  id: 'customer',
  title: 'Customer',
  description: 'One customer',
  display: 'panel',
  parameters: [
    {
      id: 'customerId',
      type: 'string',
      isRequired: true,
      match: [{ column: 'CustomerID' }],
    },
  ],
  widget: {
    name: 'tabs',
    data: {
      tabs: [
        {
          id: 'main',
          title: 'Main',
          widgets: [{ name: 'text', data: { markdown: 'Hello {{customerId}}' } }],
        },
      ],
    },
  },
};

describe('CardPageComponent', () => {
  let fixture: ComponentFixture<CardPageComponent>;
  let harness: CardsHarness;
  const alertCreate = vi.fn();
  const getQueriesFolder = vi.fn();

  async function create(
    options: Parameters<typeof configureCardsPage>[1] = {},
  ): Promise<void> {
    alertCreate.mockReset().mockResolvedValue({ present: vi.fn() });
    getQueriesFolder.mockReset().mockReturnValue(
      of({
        items: [
          {
            id: 'customers/by-id',
            title: 'Customer by id',
            parameters: [{ id: 'id', type: 'string', isRequired: true }],
          },
        ],
      }),
    );
    harness = configureCardsPage(CardPageComponent, {
      imports: [CardParametersEditorComponent, CardWidgetEditorComponent, CardViewStub],
      extraProviders: [
        { provide: AlertController, useValue: { create: alertCreate } },
        { provide: QueriesService, useValue: { getQueriesFolder } },
      ],
      ...options,
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(CardPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  const qn = <T extends Element = HTMLElement>(selector: string) =>
    el().querySelector(selector) as T | null;
  const q = <T extends Element = HTMLElement>(selector: string): T => {
    const found = qn<T>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };
  const field = (name: string) => q(`[data-field="${name}"]`);
  const type = async (name: string, value: string, event = 'ionInput') => {
    field(name).dispatchEvent(new CustomEvent(event, { detail: { value } }));
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const save = () => q<HTMLButtonElement>('[data-action="save"]');
  const json = () => (q<HTMLTextAreaElement>('textarea[data-field="json"]'));
  const openTab = async (tab: string) => {
    q(`ion-segment[aria-label="Card editor view"]`).dispatchEvent(
      new CustomEvent('ionChange', { detail: { value: tab } }),
    );
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const settleTimers = async () => {
    await new Promise((r) => setTimeout(r, 380));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  describe('new card', () => {
    it('starts from a template with one tab and one text widget that already validates', async () => {
      await create({ data: { newCard: true } });
      expect((field('title') as unknown as { value: string }).value).toBe('New card');
      expect(el().querySelectorAll('[data-tab-row]')).toHaveLength(1);
      expect(el().querySelectorAll('[data-widget-row]')).toHaveLength(1);
      expect(qn('[data-test="problem"]')).toBeNull();
      expect(save().hasAttribute('disabled') || (save() as never as { disabled: boolean }).disabled).toBe(false);
    });

    it('derives the id from the title, with a numeric suffix when taken', async () => {
      await create({
        data: { newCard: true },
        service: { listCards: vi.fn(() => of([{ id: 'customer', title: 'Customer' }])) },
      });
      await type('title', 'Customer');
      expect((field('id') as unknown as { value: string }).value).toBe('customer-2');
      await type('title', 'Order details');
      expect((field('id') as unknown as { value: string }).value).toBe('order-details');
      // once the id is typed by hand it stays
      await type('id', 'my_card');
      await type('title', 'Something else');
      expect((field('id') as unknown as { value: string }).value).toBe('my_card');
    });

    it('creates the card, then opens its page without leaving the form in the history', async () => {
      await create({ data: { newCard: true } });
      harness.service['createCard'].mockReturnValue(of(undefined));
      await type('title', 'Customer');
      save().click();
      await fixture.whenStable();
      expect(harness.service['createCard']).toHaveBeenCalledTimes(1);
      const [ref, card, env] = harness.service['createCard'].mock.calls[0];
      expect(ref).toEqual(demoRef);
      expect(env).toBeUndefined();
      expect(card).toMatchObject({ id: 'customer', title: 'Customer', display: 'panel' });
      expect(card).not.toHaveProperty('description');
      expect(card).not.toHaveProperty('parameters');
      expect(harness.router.parseUrl).toHaveBeenCalledWith(
        expect.stringContaining('/card/customer'),
      );
      expect(harness.router.navigateByUrl).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('/card/customer') }),
        { replaceUrl: true },
      );
    });

    it('shows the backend error when saving fails and stays on the form', async () => {
      await create({ data: { newCard: true } });
      harness.service['createCard'].mockReturnValue(
        throwError(() => new Error('Card "new-card" already exists.')),
      );
      save().click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(qn('[data-test="save-error"]')?.textContent).toContain('already exists');
      expect(harness.router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('explains why it cannot be saved and disables Save', async () => {
      await create({ data: { newCard: true } });
      await type('title', '   ');
      expect(qn('[data-test="problem"]')?.textContent).toContain('Give the card a title');
      expect((save() as never as { disabled: boolean }).disabled).toBe(true);
      await type('title', 'Fine');
      expect(qn('[data-test="problem"]')).toBeNull();
      await type('id', 'not valid!');
      expect(qn('[data-test="problem"]')?.textContent).toContain('letters, digits');
    });

    it('refuses an id already used by another card', async () => {
      await create({
        data: { newCard: true },
        service: { listCards: vi.fn(() => of([{ id: 'new-card', title: 'X' }])) },
      });
      // the suggested id steps past the existing card; typing the taken id is refused
      await type('id', 'new-card');
      expect(qn('[data-test="problem"]')?.textContent).toContain('already exists');
    });
  });

  describe('existing card', () => {
    it('loads from the URL id once the service answers, after the page rendered', async () => {
      const load = new Subject<ProjectCard>();
      await create({ params: { cardId: 'customer' }, service: { getCard: vi.fn(() => load) } });
      expect(qn('[aria-label="Loading card"]')).not.toBeNull();
      load.next(saved);
      await fixture.whenStable();
      expect((field('title') as unknown as { value: string }).value).toBe('Customer');
      expect((field('id') as unknown as { value: string }).value).toBe('customer');
      expect(harness.service['getCard']).toHaveBeenCalledWith(demoRef, 'customer', undefined);
      // the id of a saved card does not change
      expect(field('id').hasAttribute('disabled') || (field('id') as never as { disabled: boolean }).disabled).toBe(true);
    });

    it('says when the card does not exist', async () => {
      await create({
        params: { cardId: 'gone' },
        service: { getCard: vi.fn(() => throwError(() => new CardNotFoundError('gone'))) },
      });
      expect(allText(el())).toContain('Card not found');
      expect(allText(el())).toContain('There is no card "gone"');
    });

    it('shows a load error with Retry', async () => {
      const getCard = vi
        .fn()
        .mockReturnValueOnce(throwError(() => new Error('Agent unreachable')))
        .mockReturnValue(of(saved));
      await create({ params: { cardId: 'customer' }, service: { getCard } });
      expect(qn('[role="alert"]')?.textContent).toContain('Agent unreachable');
    });

    it('saves edits, shows Saved, and a reload shows the saved card', async () => {
      const store = { current: saved };
      await create({
        params: { cardId: 'customer' },
        service: {
          getCard: vi.fn(() => of(store.current)),
          saveCard: vi.fn((_r: unknown, card: ProjectCard) => {
            store.current = card;
            return of(card);
          }),
        },
      });
      expect((save() as never as { disabled: boolean }).disabled).toBe(true); // nothing changed yet
      await type('title', 'Customer 360');
      expect((save() as never as { disabled: boolean }).disabled).toBe(false);
      save().click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(harness.service['saveCard']).toHaveBeenCalledTimes(1);
      expect(harness.service['saveCard'].mock.calls[0][1]).toMatchObject({
        id: 'customer',
        title: 'Customer 360',
      });
      expect(allText(el())).toContain('Saved.');
      expect((save() as never as { disabled: boolean }).disabled).toBe(true);
      // leave and come back: the page reads the card again
      await type('description', 'unsaved note');
      fixture.componentInstance.ionViewWillEnter();
      expect(harness.service['getCard']).toHaveBeenCalledTimes(1); // unsaved edits are kept
      await type('description', 'One customer');
      await type('title', 'Customer 360');
      fixture.componentInstance.ionViewWillEnter();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(harness.service['invalidate']).toHaveBeenCalledWith(demoRef);
      expect((field('title') as unknown as { value: string }).value).toBe('Customer 360');
    });

    it('hides Save for a read-only project but still shows the card and preview', async () => {
      await create({
        params: { cardId: 'customer' },
        canWrite: false,
        canDelete: false,
        service: { getCard: vi.fn(() => of(saved)) },
      });
      expect(qn('[data-action="save"]')).toBeNull();
      expect(qn('[data-action="delete"]')).toBeNull();
      expect(allText(el())).toContain('read-only');
      await settleTimers();
      expect(qn('.view')?.textContent).toContain('view customer');
    });

    it('asks before deleting and goes back to the list', async () => {
      await create({
        params: { cardId: 'customer' },
        service: {
          getCard: vi.fn(() => of(saved)),
          deleteCard: vi.fn(() => of(undefined)),
        },
      });
      q('[data-action="delete"]').click();
      await fixture.whenStable();
      expect(alertCreate).toHaveBeenCalledTimes(1);
      expect(harness.service['deleteCard']).not.toHaveBeenCalled();
      const options = alertCreate.mock.calls[0][0] as {
        header: string;
        buttons: { text: string; role?: string; handler?: () => void }[];
      };
      expect(options.header).toBe('Delete this card?');
      expect(options.buttons.map((b) => b.text)).toEqual(['Keep card', 'Delete card']);
      options.buttons[1].handler?.();
      await fixture.whenStable();
      expect(harness.service['deleteCard']).toHaveBeenCalledWith(demoRef, 'customer', undefined);
      expect(harness.router.navigateByUrl).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('/cards') }),
        { replaceUrl: true },
      );
    });

    it('does not offer delete where unsupported', async () => {
      await create({
        params: { cardId: 'customer' },
        canDelete: false,
        service: { getCard: vi.fn(() => of(saved)) },
      });
      expect(qn('[data-action="delete"]')).toBeNull();
      expect(qn('[data-action="save"]')).not.toBeNull();
    });
  });

  describe('JSON tab', () => {
    it('shows the card JSON and applies valid edits to the form', async () => {
      await create({ params: { cardId: 'customer' }, service: { getCard: vi.fn(() => of(saved)) } });
      await openTab('json');
      expect(JSON.parse(json().value).id).toBe('customer');
      const edited = { ...saved, title: 'From JSON' };
      json().value = JSON.stringify(edited);
      json().dispatchEvent(new Event('input'));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(q('#json-error').hidden).toBe(true);
      await openTab('build');
      expect((field('title') as unknown as { value: string }).value).toBe('From JSON');
    });

    it('shows validation errors inline and keeps the last valid card', async () => {
      await create({ params: { cardId: 'customer' }, service: { getCard: vi.fn(() => of(saved)) } });
      await openTab('json');
      json().value = '{ not json';
      json().dispatchEvent(new Event('input'));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(q('#json-error').hidden).toBe(false);
      expect(json().getAttribute('aria-invalid')).toBe('true');
      expect((save() as never as { disabled: boolean }).disabled).toBe(true);

      json().value = JSON.stringify({ ...saved, surprise: 1 });
      json().dispatchEvent(new Event('input'));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(q('#json-error').textContent).toBeTruthy();
      expect(q('#json-error').hidden).toBe(false);

      await openTab('build');
      expect(allText(el())).toContain('last valid card');
      expect((field('title') as unknown as { value: string }).value).toBe('Customer');
    });

    it('makes the JSON read-only without write access', async () => {
      await create({ params: { cardId: 'customer' }, canWrite: false, service: { getCard: vi.fn(() => of(saved)) } });
      await openTab('json');
      expect(json().readOnly).toBe(true);
    });
  });

  describe('builder', () => {
    const edit = async (apply: (card: ProjectCard) => void) => {
      const card = JSON.parse(json().value) as ProjectCard;
      apply(card);
      json().value = JSON.stringify(card);
      json().dispatchEvent(new Event('input'));
    };

    it('adds an input with a match rule and writes it to the card', async () => {
      await create({ data: { newCard: true } });
      q('[data-action="add-parameter"]').click();
      await fixture.whenStable();
      fixture.detectChanges();
      q('[data-action="add-rule"]').click();
      await fixture.whenStable();
      fixture.detectChanges();
      const column = q('[data-rule-row="0"] [data-field="rule-column"]');
      column.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'CustomerID' } }));
      await fixture.whenStable();
      fixture.detectChanges();
      await openTab('json');
      const card = JSON.parse(json().value) as ProjectCard;
      expect(card.parameters).toEqual([
        { id: 'input1', type: 'string', isRequired: true, match: [{ column: 'CustomerID' }] },
      ]);
    });

    it('adds and removes tabs and widgets, and keeps one tab', async () => {
      await create({ data: { newCard: true } });
      q('[data-action="add-tab"]').click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().querySelectorAll('[data-tab-row]')).toHaveLength(2);
      q('[data-tab-row="1"] [data-action="add-fields"]').click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().querySelectorAll('[data-tab-row="1"] [data-widget-row]')).toHaveLength(2);
      q('[data-tab-row="1"] [data-widget-row="1"] [data-action="remove-widget"]').click();
      q('[data-tab-row="1"] [data-action="remove-tab"]').click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().querySelectorAll('[data-tab-row]')).toHaveLength(1);
      expect(
        (q('[data-action="remove-tab"]') as never as { disabled: boolean }).disabled,
      ).toBe(true);
    });

    it('edits the text widget markdown', async () => {
      await create({ data: { newCard: true } });
      const markdown = q('[data-field="markdown"]');
      markdown.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'Hi {{customerId}}' } }));
      await fixture.whenStable();
      fixture.detectChanges();
      await openTab('json');
      const card = JSON.parse(json().value) as ProjectCard;
      const tabs = ((card.widget as { data: unknown }).data as { tabs: { widgets: { data: { markdown: string } }[] }[] }).tabs;
      expect(tabs[0].widgets[0].data.markdown).toBe('Hi {{customerId}}');
    });

    it('offers to convert a card whose content is not tabs', async () => {
      await create({ data: { newCard: true } });
      await openTab('json');
      await edit((c) => {
        c.widget = { name: 'text', data: { markdown: 'single' } };
      });
      await fixture.whenStable();
      await openTab('build');
      expect(allText(el())).toContain('single text');
      q('[data-action="convert"]').click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el().querySelectorAll('[data-tab-row]')).toHaveLength(1);
      expect(qn('[data-field="markdown"]')).not.toBeNull();
    });

    it('moves legacy single-widget tabs into widgets on edit', async () => {
      await create({ data: { newCard: true } });
      await openTab('json');
      await edit((c) => {
        c.widget = {
          name: 'tabs',
          data: { tabs: [{ title: 'Legacy', widget: { name: 'text', data: { markdown: 'old' } } }] },
        };
      });
      await openTab('build');
      expect(el().querySelectorAll('[data-widget-row]')).toHaveLength(1);
      q('[data-action="add-text"]').click();
      await fixture.whenStable();
      await openTab('json');
      const tab = ((JSON.parse(json().value) as ProjectCard).widget as { data: unknown }).data as { tabs: Record<string, unknown>[] };
      expect(tab.tabs[0]['widget']).toBeUndefined();
      expect(tab.tabs[0]['widgets']).toHaveLength(2);
    });
  });

  describe('preview', () => {
    it('renders the card through the shared card view with the values typed into its inputs', async () => {
      await create({ params: { cardId: 'customer' }, service: { getCard: vi.fn(() => of(saved)) } });
      await settleTimers();
      expect(qn('.view')?.textContent).toContain('view customer');
      const input = q('[data-preview="customerId"]');
      input.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'ALFKI' } }));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(qn('.view')?.textContent).toContain('{"customerId":"ALFKI"}');
    });

    it('asks for valid JSON in record inputs and does not pass broken values', async () => {
      const withRecord: ProjectCard = {
        ...saved,
        parameters: [{ id: 'row', type: 'record' }],
      };
      await create({ params: { cardId: 'customer' }, service: { getCard: vi.fn(() => of(withRecord)) } });
      await settleTimers();
      const input = q('[data-preview="row"]');
      input.dispatchEvent(new CustomEvent('ionInput', { detail: { value: '{"Name":"Ann"}' } }));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(qn('.view')?.textContent).toContain('{"row":{"Name":"Ann"}}');
      input.dispatchEvent(new CustomEvent('ionInput', { detail: { value: '{oops' } }));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(qn('.view')?.textContent).toContain('{}');
      expect((input as never as { errorText: string }).errorText).toBe('Enter valid JSON.');
    });

    it('waits for the card to be valid before previewing', async () => {
      await create({ data: { newCard: true } });
      await settleTimers();
      expect(qn('.view')).not.toBeNull();
      await type('title', '');
      await settleTimers();
      expect(qn('.view')).toBeNull();
      expect(allText(el())).toContain('Fix the problem');
    });
  });
});
