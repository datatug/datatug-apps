import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { HostedBoardListComponent } from './hosted-board-list.component';
import { HostedBoardScope } from '../../../core/hosted-board-scope';
import { ProjectAssetsApiService } from '../../../../services/project/project-assets-api.service';
import { IProjectRef } from '../../../../core/project-context';
import { renderedText } from '../../../../testing/rendered-text.spec-helper';

type Boards = { id: string; title?: string }[];
const ref: IProjectRef = { storeId: 'firestore', spaceID: 'space', projectId: 'training' };

function fakeScope(initial: { admitted?: boolean; projectRef?: IProjectRef } = {}) {
  return {
    page: { ref: signal<IProjectRef | undefined>('projectRef' in initial ? initial.projectRef : ref) },
    admitted: signal(initial.admitted ?? true),
    identity: signal('space/training/demo'),
    canWrite: signal(false),
    loading: signal(false),
    error: signal(''),
    environment: signal('demo'),
    environments: signal(['demo', 'prod']),
    refresh: vi.fn(),
    choose: vi.fn(),
  };
}

async function setup(scope = fakeScope()) {
  const requests: Subject<Boards>[] = [];
  const api = {
    boards: vi.fn(() => {
      const request = new Subject<Boards>();
      requests.push(request);
      return request;
    }),
  };
  TestBed.overrideComponent(HostedBoardListComponent, {
    set: { providers: [{ provide: HostedBoardScope, useValue: scope }] },
  });
  TestBed.configureTestingModule({
    imports: [HostedBoardListComponent],
    providers: [provideRouter([]), { provide: ProjectAssetsApiService, useValue: api }],
  });
  const fixture = TestBed.createComponent(HostedBoardListComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  // Let promise continuations run (they schedule change detection), then wait for that render.
  const stable = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  await stable();
  // Ionic's scoped-slot patch hides light-DOM text from `textContent` in jsdom, so walk the text nodes instead.
  const text = () => renderedText(el);
  const respond = async (boards: Boards, index = requests.length - 1) => {
    requests[index].next(boards);
    await stable();
  };
  const fail = async (error: unknown, index = requests.length - 1) => {
    requests[index].error(error);
    await stable();
  };
  const button = (label: string) =>
    Array.from(el.querySelectorAll<HTMLElement>('ion-button')).find((node) => node.innerHTML.includes(label));
  const links = () => Array.from(el.querySelectorAll<HTMLAnchorElement>('ul a')).map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
  return { fixture, el, text, respond, fail, button, links, api, scope, requests, stable };
}

describe('HostedBoardListComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads boards for the admitted scope and lists them as links once they arrive', async () => {
    const { api, text, respond, links } = await setup();
    expect(api.boards).toHaveBeenCalledWith(ref, 'demo');
    expect(text()).toContain('Loading boards…');

    await respond([{ id: 'sales', title: 'Sales overview' }, { id: 'ops' }]);
    expect(text()).not.toContain('Loading boards…');
    expect(links()).toEqual([
      ['Sales overview', expect.stringMatching(/\/board\/sales\?environment=demo$/)],
      ['ops', expect.stringMatching(/\/board\/ops\?environment=demo$/)],
    ]);
  });

  it('shows the empty state when the project has no boards', async () => {
    const { text, respond } = await setup();
    await respond([]);
    expect(text()).toContain('No boards yet.');
  });

  it.each([
    [true, 1],
    [false, 0],
  ])('shows Create board only when the scope can write (canWrite=%s)', async (canWrite, count) => {
    const scope = fakeScope();
    scope.canWrite.set(canWrite);
    const { el, respond } = await setup(scope);
    await respond([]);
    const create = Array.from(el.querySelectorAll('ion-button')).filter((node) => node.innerHTML.includes('Create board'));
    expect(create).toHaveLength(count);
  });

  it('builds the new-board link from the project ref', async () => {
    const { fixture } = await setup();
    expect(fixture.componentInstance.newHref()).toMatch(/\/boards\/new$/);
  });

  it.each([
    ['an HTTP 403', new HttpErrorResponse({ status: 403 }), 'This account cannot access the Detective project in its Space.'],
    ['a plain error', new Error('Boards exploded'), 'Boards exploded'],
  ])('shows %s with a retry that refreshes the scope', async (_label, error, message) => {
    const { text, fail, button, scope } = await setup();
    await fail(error);
    expect(text()).toContain(message);
    expect(text()).not.toContain('Loading boards…');
    expect(text()).not.toContain('No boards yet.');

    button('Retry loading boards')?.click();
    await Promise.resolve();
    expect(scope.refresh).toHaveBeenCalledTimes(1);
  });

  it('reload clears the list and shows loading while the scope refreshes', async () => {
    const { fixture, respond, text, scope, stable } = await setup();
    await respond([{ id: 'sales' }]);
    fixture.componentInstance.reload();
    await stable();
    expect(scope.refresh).toHaveBeenCalled();
    expect(fixture.componentInstance.boards()).toEqual([]);
    expect(text()).toContain('Loading boards…');
  });

  it('asks the user to pick an environment when the scope is not admitted', async () => {
    const { text, api } = await setup(fakeScope({ admitted: false }));
    expect(api.boards).not.toHaveBeenCalled();
    expect(text()).toContain('Choose an available environment to view boards.');
    expect(text()).not.toContain('Project boards');
  });

  it('does not request boards without a project ref', async () => {
    const { api, text } = await setup(fakeScope({ projectRef: undefined }));
    expect(api.boards).not.toHaveBeenCalled();
    expect(text()).not.toContain('Loading boards…');
  });

  it('shows scope loading and scope errors with a project-access retry', async () => {
    const scope = fakeScope({ admitted: false });
    const { text, stable, button } = await setup(scope);
    scope.loading.set(true);
    await stable();
    expect(text()).toContain('Loading boards…');
    expect(text()).not.toContain('Choose an available environment');

    scope.loading.set(false);
    scope.error.set('Sign in to access this Detective project.');
    await stable();
    expect(text()).toContain('Sign in to access this Detective project.');
    button('Retry project access')?.click();
    expect(scope.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('ignores a superseded scope identity response and reloads for the new one (stale fails: %s)', async (staleFails) => {
    const scope = fakeScope();
    const { api, respond, fail, stable, links, text } = await setup(scope);
    scope.identity.set('space/training/prod');
    scope.environment.set('prod');
    await stable();
    expect(api.boards).toHaveBeenCalledTimes(2);
    expect(api.boards).toHaveBeenLastCalledWith(ref, 'prod');

    if (staleFails) await fail(new Error('stale failure'), 0);
    else await respond([{ id: 'stale' }], 0);
    expect(links()).toEqual([]);
    expect(text()).not.toContain('stale failure');
    expect(text()).toContain('Loading boards…');

    await respond([{ id: 'fresh' }], 1);
    expect(links()).toEqual([['fresh', expect.stringMatching(/\/board\/fresh\?environment=prod$/)]]);
  });

  it('clears boards when the scope stops being admitted', async () => {
    const scope = fakeScope();
    const { respond, stable, links, text } = await setup(scope);
    await respond([{ id: 'sales' }]);
    expect(links()).toHaveLength(1);
    scope.admitted.set(false);
    await stable();
    expect(links()).toEqual([]);
    expect(text()).toContain('Choose an available environment to view boards.');
  });

  it('renders environment options and forwards a selection to the scope', async () => {
    const { el, scope } = await setup();
    expect(Array.from(el.querySelectorAll('ion-select-option')).map((option) => option.textContent?.trim())).toEqual(['demo', 'prod']);
    el.querySelector('ion-select')?.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'prod' } }));
    expect(scope.choose).toHaveBeenCalledWith('prod');
  });
});
