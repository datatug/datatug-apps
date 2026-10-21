import {
  CUSTOM_ELEMENTS_SCHEMA,
  provideZonelessChangeDetection,
  Component,
  input,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import type { Board } from '@datatug/board-models';
import { BehaviorSubject, Subject, map, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardPageComponent } from './board-page.component';
import { ProjectAssetsReadService } from '../../../../services/project/project-assets-read.service';
import { ParameterLookupService } from '../../../../components/parameters/parameter-lookup.service';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { QueryParamsService } from '../../../../core/services/QueryParamsService';
import { routingParamBoard } from '../../../../core/datatug-routing-params';
import { BoardCardComponent } from '../../components/board-card/board-card.component';
import { TutorialBoardRuntime } from '../../../core/tutorial-board-runtime';
import { IProjectRef } from '../../../../core/project-context';

@Component({
  selector: 'sneat-datatug-board',
  imports: [BoardCardComponent],
  template: `@for (row of boardDef()?.rows; track $index) {
    @for (card of row.cards; track card.id) {
      <sneat-datatug-board-card
        [boarCardDef]="card"
        [boardId]="boardDef()?.id"
        [projectRef]="projectRef()"
      />
    }
  }`,
})
class TutorialBoardDom {
  readonly boardDef = input<Board>();
  readonly projectRef = input<IProjectRef>();
  readonly boardContext = input<unknown>();
  readonly readBoardForRun = input<unknown>();
}

const ref = {
  storeId: 'github.com',
  projectId: 'datatug-demo-project@datatug@demo-project-1',
};
const saved: Board = {
  id: 'showcase',
  title: 'Saved showcase',
  rows: [
    {
      cards: [
        { id: 'first', title: 'First card' },
        { id: 'second', title: 'Second card' },
      ],
    },
  ],
};

describe('BoardPage same-route tutorial overlay', () => {
  beforeEach(() => sessionStorage.clear());

  async function harness(
    board: Board = saved,
    initialMode: string | null = null,
    renderUi = false,
    renderCards = false,
  ) {
    const mode = new BehaviorSubject<string | null>(initialMode);
    const queryParamMap = mode.asObservable().pipe(
      map((value) => ({
        get: (key: string) =>
          key === 'mode' ? value : key === 'env' ? 'dev' : null,
      })),
    );
    const boardResult = new Subject<Board>();
    const navigate = vi.fn().mockResolvedValue(true);
    const route = {
      queryParamMap,
      paramMap: of({
        get: (key: string) => (key === routingParamBoard ? board.id : null),
      }),
      snapshot: {
        paramMap: {
          get: (key: string) => (key === routingParamBoard ? board.id : null),
        },
      },
    };
    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
        {
          provide: ProjectAssetsReadService,
          useValue: { board: vi.fn(() => boardResult.asObservable()) },
        },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigate } },
        {
          provide: ParameterLookupService,
          useValue: { lookupParameterValue: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of({ ref }),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: QueryParamsService,
          useValue: { setQueryParameter: vi.fn() },
        },
      ],
    })
      .overrideComponent(BoardPageComponent, {
        set: {
          imports: renderCards ? [TutorialBoardDom] : [],
          ...(renderUi
            ? {}
            : {
                template:
                  '<p class="display-count">{{ displayBoard()?.rows?.[0]?.cards?.length ?? "none" }}</p>',
              }),
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [TutorialBoardRuntime],
        },
      })
      .overrideComponent(BoardCardComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(BoardPageComponent);
    const page = fixture.componentInstance;
    boardResult.next(board);
    await fixture.whenStable();
    return { fixture, page, mode, navigate, route };
  }

  it('shows the canonical board by default, then starts an empty session copy without a full-board flash', async () => {
    const { fixture, page, mode, navigate, route } = await harness();
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('2');
    expect(page.tutorialBoard()).toBeUndefined();

    mode.next('tutorial');
    expect(page.displayBoard()).toBeUndefined();
    await vi.waitFor(() => expect(page.tutorialBoard()).toBeTruthy());
    await fixture.whenStable();
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('0');

    page.addNextTutorialCard();
    expect(
      page.displayBoard()?.rows?.[0].cards?.map((card) => card.id),
    ).toEqual(['first']);
    page.previousTutorialStep();
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(0);
    page.addNextTutorialCard();
    page.takeTutorialControl();
    const firstCard = page.displayBoard()?.rows?.[0].cards?.[0];
    const savedCards = saved.rows?.[0]?.cards;
    if (!savedCards || savedCards.length < 2) {
      throw new Error('Tutorial test fixture needs two cards');
    }
    page.addTutorialCard(savedCards[1]);
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(2);
    expect(page.displayBoard()?.rows?.[0].cards?.[0]).toBe(firstCard);
    page.moveTutorialCard(savedCards[0], 0, 1);
    expect(
      page.displayBoard()?.rows?.[0].cards?.map((card) => card.id),
    ).toEqual(['second', 'first']);
    expect(page.displayBoard()?.rows?.[0].cards?.[1]).toBe(firstCard);
    page.removeTutorialCard(savedCards[0]);
    expect(
      page.displayBoard()?.rows?.[0].cards?.map((card) => card.id),
    ).toEqual(['second']);
    page.resumeTutorial();
    page.restartTutorial();
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(0);
    expect(page.boardDef()?.rows?.[0].cards).toHaveLength(2);

    page.addNextTutorialCard();
    page.showFullBoard();
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: { mode: null },
      queryParamsHandling: 'merge',
    });
    mode.next(null);
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(2);
    const canonical = JSON.stringify(page.boardDef());
    page.showFullBoard();
    page.showFullBoard();
    expect(JSON.stringify(page.displayBoard())).toBe(canonical);
    expect(JSON.stringify(page.boardDef())).toBe(canonical);
    mode.next('tutorial');
    expect(page.displayBoard()).toBeUndefined();
    await vi.waitFor(() =>
      expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(1),
    );
    page.buildStepByStep();
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: { mode: 'tutorial' },
      queryParamsHandling: 'merge',
    });
    fixture.destroy();
  });

  it('renders a non-showcase board normally even when tutorial mode is requested', async () => {
    const other: Board = { ...saved, id: 'other' };
    const { fixture, page } = await harness(other, 'tutorial');
    expect(page.tutorialActive()).toBe(false);
    expect(page.displayBoard()?.id).toBe('other');
    expect(page.tutorialBoard()).toBeUndefined();
    fixture.destroy();
  });

  it('preserves ordinary-board keyboard focus when removing a stray tutorial mode', async () => {
    const board: Board = { ...saved, id: 'other' };
    const { fixture, page, mode } = await harness(
      board,
      'tutorial',
      true,
      true,
    );
    const heading = fixture.nativeElement.querySelector(
      '[data-board-page-heading]',
    ) as HTMLElement;
    const focus = vi.spyOn(heading, 'focus');
    const retained = document.createElement('button');
    retained.textContent = 'Ordinary board control';
    fixture.nativeElement.appendChild(retained);
    retained.focus();
    expect(page.tutorialActive()).toBe(false);
    mode.next(null);
    await fixture.whenStable();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(retained);
    expect(page.displayBoard()).toBe(board);
    fixture.destroy();
  });

  it('disables guide and empty-canvas Next at the shared action cap while preserving redo', async () => {
    const { fixture, page } = await harness(saved, 'tutorial', true);
    await vi.waitFor(() => expect(page.tutorialBoard()).toBeTruthy());
    page.takeTutorialControl();
    const card = saved.rows?.[0].cards?.[0];
    if (!card) throw new Error('Missing card');
    for (let index = 0; index < 128; index++) {
      page.addTutorialCard(card);
      page.removeTutorialCard(card);
    }
    page.resumeTutorial();
    await fixture.whenStable();
    expect(page.tutorialStatus()?.canNext).toBe(false);
    expect(
      fixture.nativeElement.querySelector('.tutorial-progress').textContent,
    ).toContain('Session action limit reached');
    expect(
      fixture.nativeElement.querySelector('.tutorial-progress').textContent,
    ).not.toContain('Next:');
    const buttons = () =>
      Array.from(
        fixture.nativeElement.querySelectorAll(
          'button',
        ) as NodeListOf<HTMLButtonElement>,
      );
    expect(
      buttons().find((button) => button.textContent?.trim() === 'Next Step')
        ?.disabled,
    ).toBe(true);
    expect(
      buttons().find(
        (button) => button.textContent?.trim() === 'Add the first card',
      )?.disabled,
    ).toBe(true);
    page.previousTutorialStep();
    expect(page.tutorialStatus()?.canNext).toBe(true);
    page.addNextTutorialCard();
    expect(page.tutorialStatus()?.canNext).toBe(false);
    expect(page.visibleTutorialCards()).toHaveLength(0);
    fixture.destroy();
  });

  it('uses the card ID for move labels when its title is absent', async () => {
    const board: Board = {
      ...saved,
      rows: [
        {
          cards: [
            { id: 'untitled', title: '' },
            { id: 'second', title: 'Second' },
          ],
        },
      ],
    };
    const { fixture, page } = await harness(board, 'tutorial', true);
    await vi.waitFor(() => expect(page.tutorialBoard()).toBeTruthy());
    page.addNextTutorialCard();
    page.addNextTutorialCard();
    page.takeTutorialControl();
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Move untitled up"]'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Move untitled down"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.innerHTML).not.toContain('Move undefined');
    fixture.destroy();
  });

  it('moves keyboard focus on tutorial route entry, exit, and restored-session entry', async () => {
    const { fixture, page, mode, navigate, route } = await harness(
      saved,
      null,
      true,
      true,
    );
    const button = (label: string) => {
      const target = Array.from(
        fixture.nativeElement.querySelectorAll(
          'button',
        ) as NodeListOf<HTMLButtonElement>,
      ).find((button) => button.textContent?.trim() === label);
      if (!target) throw new Error(`Missing ${label}`);
      return target;
    };
    const entry = button('Build Step by Step');
    entry.focus();
    entry.click();
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: { mode: 'tutorial' },
      queryParamsHandling: 'merge',
    });
    mode.next('tutorial');
    await vi.waitFor(() => expect(page.tutorialBoard()).toBeTruthy());
    await fixture.whenStable();
    expect(entry.isConnected).toBe(false);
    expect(
      document.activeElement?.hasAttribute('data-tutorial-empty-focus'),
    ).toBe(true);
    button('Add the first card').click();
    await fixture.whenStable();
    const exit = button('Show Full Dashboard');
    exit.focus();
    exit.click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      relativeTo: route,
      queryParams: { mode: null },
      queryParamsHandling: 'merge',
    });
    mode.next(null);
    await fixture.whenStable();
    expect(exit.isConnected).toBe(false);
    expect(
      document.activeElement?.hasAttribute('data-board-page-heading'),
    ).toBe(true);
    expect(document.activeElement?.textContent?.trim()).toBe('Saved showcase');
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(2);
    button('Build Step by Step').focus();
    button('Build Step by Step').click();
    mode.next('tutorial');
    await vi.waitFor(() =>
      expect(page.tutorialBoard()?.rows?.[0].cards).toHaveLength(1),
    );
    await fixture.whenStable();
    expect(
      document.activeElement?.hasAttribute('data-tutorial-route-heading'),
    ).toBe(true);
    expect(document.activeElement?.textContent?.trim()).toBe(
      'Build this dashboard',
    );
    fixture.destroy();
  });

  it('clears the guided card notice and uses the free-edit cue for a direct session edit', async () => {
    const { fixture, page } = await harness(saved, 'tutorial', true, true);
    await vi.waitFor(() => expect(page.tutorialBoard()).toBeTruthy());
    page.addNextTutorialCard();
    await fixture.whenStable();
    const runtime = fixture.debugElement.injector.get(TutorialBoardRuntime);
    expect(runtime.notice()).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('.tutorial-card-guide'),
    ).toBeTruthy();
    page.editTutorial({ type: 'add-card', cardId: 'second' });
    await fixture.whenStable();
    expect(runtime.notice()).toBeUndefined();
    expect(
      fixture.nativeElement.querySelector('.tutorial-card-guide'),
    ).toBeNull();
    const progress =
      fixture.nativeElement.querySelector('.tutorial-progress').textContent;
    expect(progress).toContain('Editing freely');
    expect(progress).not.toContain('Next:');
    expect(page.tutorialAnnouncement()).not.toContain('Next:');
    fixture.destroy();
  });

  it('keeps keyboard focus on the stable guide heading as card content changes, announces views/tabs, and exposes the source limit', async () => {
    const board: Board = {
      ...saved,
      rows: [
        {
          cards: [
            {
              id: 'race',
              title: 'Orders race',
              widget: {
                name: 'chart',
                data: {
                  sources: [{ id: 'orders', queryId: 'demodb/orders' }],
                  chart: {
                    type: 'bar-race',
                    periodColumn: 'month',
                    categoryColumn: 'country',
                    valueColumn: 'orders',
                    unit: 'orders',
                    grain: 'month',
                    onDuplicate: 'reject',
                    mode: 'period',
                    topN: 10,
                  },
                  defaultView: 'chart',
                },
              },
            },
            {
              id: 'inspect',
              title: 'Inspection',
              widget: {
                name: 'tabs',
                data: {
                  tabs: [
                    {
                      id: 'sqlite',
                      title: 'SQLite',
                      widget: {
                        name: 'SQL',
                        data: { sql: { queryId: 'demodb/orders' } },
                      },
                    },
                    {
                      id: 'pg',
                      title: 'PostgreSQL',
                      widget: {
                        name: 'SQL',
                        data: { sql: { queryId: 'demodb/countries' } },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    };
    const scroll = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scroll,
      configurable: true,
    });
    const canonicalJson = JSON.stringify(board);
    const { fixture, page } = await harness(board, 'tutorial', true, true);
    const runtime = fixture.debugElement.injector.get(TutorialBoardRuntime);
    await vi.waitFor(() => expect(page.tutorialBoard()).toBeTruthy());
    await fixture.whenStable();
    const activate = async (label: string, withinCard = false) => {
      const scope = withinCard
        ? fixture.nativeElement.querySelector('.tutorial-card-guide')
        : fixture.nativeElement;
      const button = Array.from(
        scope.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
      ).find((button) => button.textContent?.trim() === label);
      if (!button) throw new Error(`Missing ${label}`);
      button.focus();
      expect(document.activeElement).toBe(button);
      // A native button's keyboard activation delivers a click.
      button.click();
      await fixture.whenStable();
    };
    await activate('Add the first card');
    expect(
      document.activeElement?.hasAttribute('data-tutorial-guide-focus'),
    ).toBe(true);
    expect(document.activeElement?.textContent).toContain(
      'Inspect the source rows',
    );
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
    await activate('Next Step', true);
    expect(
      document.activeElement?.hasAttribute('data-tutorial-guide-focus'),
    ).toBe(true);
    expect(document.activeElement?.textContent).toContain(
      'Return to the paused race',
    );
    expect(
      fixture.nativeElement.querySelector('[aria-live="polite"]').textContent,
    ).toContain('Inspect the source rows');
    expect(
      page.displayBoard()?.rows?.[0].cards?.[0].widget?.data,
    ).toHaveProperty('defaultView', 'chart');
    expect(runtime.presentationView('race', [])).toBe('grid');
    expect(JSON.stringify(board)).toBe(canonicalJson);
    expect(
      fixture.nativeElement.querySelector('.tutorial-progress').textContent,
    ).toContain('Return to the paused race');
    await activate('Next Step', true);
    expect(runtime.presentationView('race', [])).toBe('chart');
    expect(document.activeElement?.textContent).toContain('Add Inspection');
    await activate('Next Step', true);
    expect(
      document.activeElement?.hasAttribute('data-tutorial-guide-focus'),
    ).toBe(true);
    await activate('Next Step', true);
    expect(document.activeElement?.textContent).toContain(
      'Explore another source',
    );
    expect(
      fixture.nativeElement.querySelector('.tutorial-card-guide').textContent,
    ).toContain('This dashboard has no independent-source comparison configured');
    expect(
      fixture.nativeElement.querySelector('[aria-live="polite"]').textContent,
    ).toContain('Inspect PostgreSQL');
    await activate('Previous Step', true);
    expect(
      document.activeElement?.hasAttribute('data-tutorial-guide-focus'),
    ).toBe(true);
    expect(document.activeElement?.textContent).toContain('Inspect PostgreSQL');
    expect(
      fixture.nativeElement.querySelector('[aria-live="polite"]').textContent,
    ).toContain('Previous step restored');
    await activate('Take Control');
    expect(
      document.activeElement?.hasAttribute('data-tutorial-authoring-focus'),
    ).toBe(true);
    expect(fixture.nativeElement.querySelector('sneat-datatug-chart-source-editor')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Add another source (unavailable)');
    await activate('Restart');
    expect(
      document.activeElement?.hasAttribute('data-tutorial-empty-focus'),
    ).toBe(true);
    fixture.destroy();
    if (descriptor)
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollIntoView',
        descriptor,
      );
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('uses real guide actions and tab authoring controls, preserves edited references, and restores only session storage', async () => {
    const editable: Board = {
      id: 'showcase',
      title: 'Saved showcase',
      rows: [
        {
          cards: [
            {
              id: 'race',
              title: 'Orders race',
              widget: {
                name: 'chart',
                data: {
                  sources: [
                    {
                      id: 'orders',
                      queryId: 'demodb/orders',
                      transform: {
                        name: 'orders-monthly-country-count',
                        orderIdColumn: 'OrderID',
                        dateColumn: 'OrderDate',
                        countryColumn: 'ShipCountry',
                      },
                    },
                  ],
                  chart: {
                    type: 'bar-race',
                    periodColumn: 'period',
                    categoryColumn: 'category',
                    valueColumn: 'value',
                    unit: 'orders',
                    grain: 'month',
                    onDuplicate: 'reject',
                    mode: 'period',
                    topN: 10,
                  },
                  defaultView: 'chart',
                },
              },
            },
            {
              id: 'inspect',
              title: 'Source inspection',
              widget: {
                name: 'tabs',
                data: {
                  tabs: [
                    {
                      id: 'sqlite',
                      title: 'SQLite',
                      widget: {
                        name: 'SQL',
                        data: { sql: { queryId: 'demodb/orders' } },
                      },
                    },
                    {
                      id: 'pg',
                      title: 'PostgreSQL',
                      widget: {
                        name: 'SQL',
                        data: { sql: { queryId: 'demodb/countries' } },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    };
    const canonicalJson = JSON.stringify(editable);
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    const { fixture, page, mode } = await harness(editable, 'tutoril', true);
    await vi.waitFor(() => expect(page.tutorialBoard()).toBeTruthy());
    await fixture.whenStable();
    const runtime = fixture.debugElement.injector.get(TutorialBoardRuntime);
    expect(fixture.nativeElement.textContent).toContain(
      'Your canvas starts here',
    );
    expect(fixture.nativeElement.textContent).toContain('demodb/orders');
    const click = async (text: string) => {
      const button = Array.from(
        fixture.nativeElement.querySelectorAll(
          'button',
        ) as NodeListOf<HTMLButtonElement>,
      ).find((button) => button.textContent?.trim() === text);
      if (!button) throw new Error(`Missing button ${text}`);
      button.click();
      await fixture.whenStable();
    };
    await click('Add the first card');
    expect(page.tutorialGuide()?.step.title).toBe('Inspect the monthly trend');
    const originalRace = page.displayBoard()?.rows?.[0].cards?.[0];
    await click('Next Step');
    expect(runtime.presentationView('race', [])).toBe('trend');
    expect(page.tutorialGuide()?.step.title).toBe('Inspect the source rows');
    await click('Previous');
    expect(runtime.presentationView('race', [])).toBeUndefined();
    expect(page.tutorialGuide()?.step.title).toBe('Inspect the monthly trend');
    await click('Next Step');
    await click('Next Step');
    expect(runtime.presentationView('race', [])).toBe('grid');
    expect(page.tutorialGuide()?.step.title).toBe('Return to the paused race');
    expect(page.displayBoard()?.rows?.[0].cards?.[0]).toBe(originalRace);
    expect(originalRace?.widget?.data).toHaveProperty('defaultView', 'chart');
    await click('Next Step');
    expect(runtime.presentationView('race', [])).toBe('chart');
    expect(page.tutorialGuide()?.step.title).toBe('Add Source inspection');
    await click('Next Step');
    expect(page.tutorialGuide()?.step.title).toBe('Inspect PostgreSQL');
    await click('Next Step');
    expect(page.tutorialGuide()?.step.limitation).toContain('no independent-source comparison configured');
    await click('Take Control');
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll(
          'button, ion-button',
        ) as NodeListOf<HTMLElement>,
      ).some((button) =>
        /^(Save|Update)( board| dashboard)?$/i.test(
          button.textContent?.trim() ?? '',
        ),
      ),
    ).toBe(false);
    const race = page.displayBoard()?.rows?.[0].cards?.[0];
    const title = fixture.nativeElement.querySelector(
      'input[placeholder="My query tab"]',
    ) as HTMLInputElement;
    title.value = 'My country query';
    const newQuery = fixture.nativeElement.querySelector(
      '.tutorial-add-tab select',
    ) as HTMLSelectElement;
    newQuery.value = 'demodb/countries';
    await click('Add tab');
    expect(page.displayBoard()?.rows?.[0].cards?.[0]).toBe(race);
    const edited = page.displayBoard()?.rows?.[0].cards?.[1];
    expect(edited?.widget?.data).toHaveProperty('tabs.length', 3);
    const editor = page.tutorialEditors().find((editor) => editor.tabs);
    if (!editor?.tabs) throw new Error('Missing tab editor');
    page.tabAction(editor, 'select-tab', editor.tabs[2].key);
    const chartEditor = page.tutorialEditors().find((editor) => editor.chart);
    if (!chartEditor) throw new Error('Missing chart editor');
    const resultView = Array.from(
      fixture.nativeElement.querySelectorAll(
        'label',
      ) as NodeListOf<HTMLLabelElement>,
    )
      .find((label) => label.textContent?.trim().startsWith('Result view'))
      ?.querySelector('select');
    if (!resultView) throw new Error('Missing Result view authoring control');
    expect(resultView.value).toBe('chart');
    resultView.value = 'grid';
    resultView.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    expect(resultView.value).toBe('grid');
    expect(runtime.presentationView('race', [])).toBeUndefined();
    expect(
      page.displayBoard()?.rows?.[0].cards?.[0].widget?.data,
    ).toHaveProperty('defaultView', 'grid');
    expect(page.displayBoard()?.rows?.[0].cards?.[1]).toBe(edited);
    await click('Resume Guide');
    await click('Previous');
    expect(runtime.presentationView('race', [])).toBe('chart');
    expect(
      page.displayBoard()?.rows?.[0].cards?.[0].widget?.data,
    ).toHaveProperty('defaultView', 'chart');
    await click('Next Step');
    expect(runtime.presentationView('race', [])).toBeUndefined();
    expect(
      page.displayBoard()?.rows?.[0].cards?.[0].widget?.data,
    ).toHaveProperty('defaultView', 'grid');
    expect(page.displayBoard()?.rows?.[0].cards?.[1]).toEqual(edited);
    expect(JSON.stringify(editable)).toBe(canonicalJson);
    expect(
      persist.mock.instances.every((instance) => instance === sessionStorage),
    ).toBe(true);
    mode.next(null);
    await fixture.whenStable();
    expect(page.displayBoard()).toBe(editable);
    mode.next('tutorial');
    await vi.waitFor(() =>
      expect(
        page.tutorialEditors().find((editor) => editor.tabs)?.tabs,
      ).toHaveLength(3),
    );
    await fixture.whenStable();
    expect(
      page.displayBoard()?.rows?.[0].cards?.[0].widget?.data,
    ).toHaveProperty('defaultView', 'grid');
    expect(runtime.presentationView('race', [])).toBeUndefined();
    mode.next(null);
    await fixture.whenStable();
    sessionStorage.clear();
    mode.next('tutorial');
    await vi.waitFor(() =>
      expect(page.tutorialBoard()?.rows?.[0].cards).toHaveLength(0),
    );
    await fixture.whenStable();
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(0);
    await click('Restart');
    expect(page.visibleTutorialCards()).toHaveLength(0);
    expect(JSON.stringify(editable)).toBe(canonicalJson);
    persist.mockRestore();
    fixture.destroy();
  });
});
