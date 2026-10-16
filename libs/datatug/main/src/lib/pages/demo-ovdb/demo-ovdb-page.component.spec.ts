import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  type Params,
} from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeCloudFetch } from '../../demo-postgresql/demo-postgresql.spec-helper';
import { OvdbConfirmService } from '../../ovdb/ovdb-confirm.service';
import { DemoOvdbPageComponent } from './demo-ovdb-page.component';

async function setup(params: Params, fake = fakeCloudFetch()) {
  vi.stubGlobal('fetch', fake.fetch);
  const paramMap = new BehaviorSubject(convertToParamMap(params));
  await TestBed.configureTestingModule({
    imports: [DemoOvdbPageComponent],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { paramMap, snapshot: { paramMap: paramMap.value } },
      },
      {
        provide: OvdbConfirmService,
        useValue: { confirm: vi.fn(async () => true) },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(DemoOvdbPageComponent);
  const el = fixture.nativeElement as HTMLElement;
  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return { fixture, el, q, settle, paramMap, ...fake };
}

describe('DemoOvdbPageComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('lists the hosted editions for /demo/ovdb without touching the network', async () => {
    const { q, el, requests } = await setup({});
    expect(q('demo-ovdb-editions')?.textContent).toContain(
      'Explore a hosted PostgreSQL DemoDB',
    );
    expect(q('edition-sakila')?.getAttribute('href')).toBe(
      '/demo/ovdb/sakila-postgresql',
    );
    expect(el.querySelectorAll('[data-testid^="edition-"]').length).toBe(6);
    expect(requests).toHaveLength(0);
  });

  it('explains an unknown database and a SQLite id, and links to the known editions', async () => {
    for (const database of ['nope', 'chinook']) {
      TestBed.resetTestingModule();
      const { q, requests } = await setup({ database });
      expect(q('demo-ovdb-editions')?.textContent).toContain(
        `There is no hosted DemoDB database “${database}”`,
      );
      expect(q('edition-chinook')).not.toBeNull();
      expect(requests).toHaveLength(0);
    }
  });

  it('opens an edition case-insensitively, through OVDB, and lands read-only in its table list', async () => {
    const { q, el, requests, settle } = await setup({
      database: 'Chinook-PostgreSQL',
    });
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-table-list')).not.toBeNull();
    });
    expect(q('demo-ovdb-connecting')).toBeNull();
    expect(q('table-Artist')?.getAttribute('href')).toBe(
      '/demo/ovdb/chinook-postgresql/table/Artist',
    );
    expect(q('table-Album')).not.toBeNull();
    expect(q('ovdb-status')?.textContent).toBe(
      'Hosted PostgreSQL (read-only via OpenVaultDB)',
    );
    expect(q('ovdb-database-header')?.textContent).toContain('read-only');
    expect(q('demo-ovdb-readonly')?.textContent).toContain(
      'holds no database credentials',
    );
    expect(q('demo-ovdb-sqlite-link')?.getAttribute('href')).toBe(
      '/demo/sqlite/chinook',
    );
    // No mutation control of any kind.
    expect(
      el.querySelector(
        '[data-testid="reset-database"], [data-testid="record-edit"], [data-testid="record-delete"]',
      ),
    ).toBeNull();
    // Only the public server was asked, once.
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET https://cloud.openvaultdb.com/v1/databases/chinook-postgresql',
    ]);
  });

  it('opens straight into a table, shows its rows and a read-only record', async () => {
    const { q, el, settle, requests } = await setup({
      database: 'chinook-postgresql',
      table: 'Artist',
    });
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-rows')?.textContent).toContain('AC/DC');
    });
    expect(el.querySelectorAll('[data-testid^="row-"]').length).toBe(2);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST',
      url: 'https://cloud.openvaultdb.com/v1/databases/chinook-postgresql/dtql',
    });
    (q('row-0') as HTMLElement).click();
    await settle();
    expect(q('ovdb-record')?.textContent).toContain('ArtistId');
    expect(q('ovdb-record')?.textContent).toContain('primary key');
    expect(
      el.querySelector(
        '[data-testid="record-edit"], [data-testid="record-delete"], [data-testid="record-save"]',
      ),
    ).toBeNull();
  });

  it('keeps the connection when only the table changes', async () => {
    const { q, settle, paramMap, requests } = await setup({
      database: 'chinook-postgresql',
    });
    paramMap.next(
      convertToParamMap({ database: 'chinook-postgresql', table: 'Album' }),
    );
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-table')).not.toBeNull();
    });
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(1);
  });

  it('shows a connecting state while the hosted database wakes up', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeCloudFetch();
    const slow: typeof fetch = async (input, init) => {
      await gate;
      return fake.fetch(input, init);
    };
    const { q, settle } = await setup(
      { database: 'pubs-postgresql' },
      { fetch: slow, requests: fake.requests },
    );
    expect(q('demo-ovdb-connecting')?.textContent).toContain(
      'Connecting to Pubs through OpenVaultDB',
    );
    expect(q('ovdb-table-list')).toBeNull();
    release();
    // The fake only knows chinook-postgresql: pubs-postgresql is answered 501 and reported readably.
    await vi.waitFor(async () => {
      await settle();
      expect(q('demo-ovdb-failed')).not.toBeNull();
    });
    expect(q('demo-ovdb-failed')?.textContent).toMatch(
      /does not support this operation/,
    );
  });

  it('says so when the hosted database stays unavailable, and Try again opens it', async () => {
    const down = fakeCloudFetch({ statuses: [503, 503, 503, 503, 503] });
    // No back-off in the spec: the default delays are covered in ovdb-retrying-fetch.spec.ts.
    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', ((fn: () => void) =>
      realSetTimeout(fn, 0)) as typeof setTimeout);
    const { q, settle } = await setup({ database: 'chinook-postgresql' }, down);
    await vi.waitFor(async () => {
      await settle();
      expect(q('demo-ovdb-failed')).not.toBeNull();
    });
    expect(q('demo-ovdb-failed')?.textContent).toMatch(
      /waking up or temporarily unavailable/,
    );
    expect(q('ovdb-table-list')).toBeNull();
    (q('demo-ovdb-retry') as HTMLElement).click();
    await vi.waitFor(async () => {
      await settle();
      expect(q('ovdb-table-list')).not.toBeNull();
    });
    expect(q('demo-ovdb-failed')).toBeNull();
  });

  it('ignores a connection that finished after the page moved on', async () => {
    const fake = fakeCloudFetch();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held: typeof fetch = async (input, init) => {
      if (String(input).includes('chinook')) await gate;
      return fake.fetch(input, init);
    };
    const { q, settle, paramMap } = await setup(
      { database: 'chinook-postgresql' },
      { fetch: held, requests: fake.requests },
    );
    paramMap.next(convertToParamMap({}));
    await settle();
    expect(q('demo-ovdb-editions')).not.toBeNull();
    release();
    await settle();
    expect(q('demo-ovdb-editions')).not.toBeNull();
    expect(q('ovdb-table-list')).toBeNull();
  });

  it('goes back to the list from a database and to the database from a table', async () => {
    const { fixture, paramMap, settle } = await setup({
      database: 'chinook-postgresql',
    });
    const back = () => fixture.componentInstance['backHref']();
    expect(back()).toBe('/demo/ovdb');
    paramMap.next(
      convertToParamMap({ database: 'chinook-postgresql', table: 'Album' }),
    );
    await settle();
    expect(back()).toBe('/demo/ovdb/chinook-postgresql');
  });
});
