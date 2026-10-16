import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
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

const ref = { storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' };
const saved: Board = {
  id: 'showcase', title: 'Saved showcase', rows: [{ cards: [
    { id: 'first', title: 'First card' }, { id: 'second', title: 'Second card' },
  ] }],
};

describe('BoardPage same-route tutorial overlay', () => {
  beforeEach(() => sessionStorage.clear());

  async function harness(board: Board = saved, initialMode: string | null = null) {
    const mode = new BehaviorSubject<string | null>(initialMode);
    const queryParamMap = mode.asObservable().pipe(map(value => ({
      get: (key: string) => key === 'mode' ? value : key === 'env' ? 'dev' : null,
    })));
    const boardResult = new Subject<Board>();
    const navigate = vi.fn().mockResolvedValue(true);
    const route = {
      queryParamMap,
      paramMap: of({ get: (key: string) => key === routingParamBoard ? board.id : null }),
      snapshot: { paramMap: { get: (key: string) => key === routingParamBoard ? board.id : null } },
    };
    await TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
        { provide: ProjectAssetsReadService, useValue: { board: vi.fn(() => boardResult.asObservable()) } },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: { navigate } },
        { provide: ParameterLookupService, useValue: { lookupParameterValue: vi.fn() } },
        { provide: DatatugNavContextService, useValue: { currentProject: of({ ref }), currentEnv: of(undefined), setCurrentEnvironment: vi.fn() } },
        { provide: QueryParamsService, useValue: { setQueryParameter: vi.fn() } },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: {
        imports: [],
        template: '<p class="display-count">{{ displayBoard()?.rows?.[0]?.cards?.length ?? "none" }}</p>',
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
        providers: [],
      },
    }).compileComponents();
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
    expect(page.displayBoard()?.rows?.[0].cards?.map(card => card.id)).toEqual(['first']);
    page.previousTutorialStep();
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(0);
    page.addNextTutorialCard();
    page.takeTutorialControl();
    const savedCards = saved.rows?.[0]?.cards;
    if (!savedCards || savedCards.length < 2) {
      throw new Error('Tutorial test fixture needs two cards');
    }
    page.addTutorialCard(savedCards[1]);
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(2);
    page.moveTutorialCard(savedCards[0], 0, 1);
    expect(page.displayBoard()?.rows?.[0].cards?.map(card => card.id)).toEqual(['second', 'first']);
    page.removeTutorialCard(savedCards[0]);
    expect(page.displayBoard()?.rows?.[0].cards?.map(card => card.id)).toEqual(['second']);
    page.resumeTutorial();
    page.restartTutorial();
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(0);
    expect(page.boardDef()?.rows?.[0].cards).toHaveLength(2);

    page.addNextTutorialCard();
    page.showFullBoard();
    expect(navigate).toHaveBeenCalledWith([], { relativeTo: route, queryParams: { mode: null }, queryParamsHandling: 'merge' });
    mode.next(null);
    expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(2);
    mode.next('tutorial');
    expect(page.displayBoard()).toBeUndefined();
    await vi.waitFor(() => expect(page.displayBoard()?.rows?.[0].cards).toHaveLength(1));
    page.buildStepByStep();
    expect(navigate).toHaveBeenCalledWith([], { relativeTo: route, queryParams: { mode: 'tutorial' }, queryParamsHandling: 'merge' });
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
});
