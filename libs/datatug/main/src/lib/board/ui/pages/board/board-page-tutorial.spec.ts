import {
  CUSTOM_ELEMENTS_SCHEMA,
  provideZonelessChangeDetection,
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
          imports: [],
          ...(renderUi
            ? {}
            : {
                template:
                  '<p class="display-count">{{ displayBoard()?.rows?.[0]?.cards?.length ?? "none" }}</p>',
              }),
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
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
    expect(page.tutorialGuide()?.step.title).toBe('Inspect the source rows');
    await click('Next Step');
    expect(
      page.displayBoard()?.rows?.[0].cards?.[0].widget?.data,
    ).toHaveProperty('defaultView', 'grid');
    await click('Previous');
    expect(
      page.displayBoard()?.rows?.[0].cards?.[0].widget?.data,
    ).toHaveProperty('defaultView', 'chart');
    await click('Next Step');
    await click('Next Step');
    await click('Next Step');
    await click('Next Step');
    expect(page.tutorialGuide()?.step.limitation).toContain('unavailable');
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
    page.setTutorialView(chartEditor, 'grid');
    expect(page.displayBoard()?.rows?.[0].cards?.[1]).toBe(edited);
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
