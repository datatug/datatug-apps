import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Request, Route } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import {
  finalizeShowcaseMeasurement,
  installShowcaseMeasurementLedger,
} from '../../e2e/helpers/showcase-measurement-ledger';

const ordersQuery = readFileSync(
  resolve(
    process.cwd(),
    'apps/datatug-app/e2e/fixtures/northwind-orders-query.dtql',
  ),
  'utf8',
);
const queryURL = 'https://ovdb.demodb.dev/v1/databases/northwind/dtql';
const queryBody = JSON.stringify({ query: ordersQuery });

function request(url: string, method = 'POST', body = queryBody): Request {
  return {
    url: () => url,
    method: () => method,
    postData: () => body,
  } as Request;
}
async function harness(maxQueries?: 3 | 12) {
  const events = new EventEmitter();
  let routeHandler: ((route: Route) => Promise<void>) | undefined;
  const context = {
    on: events.on.bind(events),
    route: async (_pattern: string, handler: typeof routeHandler) => {
      routeHandler = handler;
    },
  };
  const ledger = await installShowcaseMeasurementLedger(
    context as unknown as BrowserContext,
    { maxQueries },
  );
  const send = async (req: Request) => {
    const proceed = vi.fn(),
      abort = vi.fn();
    events.emit('request', req);
    if (!routeHandler) throw new Error('Missing test route guard');
    await routeHandler({
      request: () => req,
      continue: proceed,
      abort,
    } as unknown as Route);
    return { proceed, abort };
  };
  return { ledger, send, events };
}

describe('opt-in production measurement protection without network', () => {
  it('recognizes the pinned Orders JSON query and protects the phase budget before transmission', async () => {
    const { ledger, send } = await harness();
    ledger.phase('initial', 1, { orders: 1 });
    const first = await send(request(queryURL));
    expect(first.proceed).toHaveBeenCalledOnce();
    expect(ledger.rows[0]).toMatchObject({
      query: 'orders',
      bodyFormat: 'json-query-string',
      transport: 'direct',
    });
    const second = await send(request(queryURL));
    expect(second.abort).toHaveBeenCalledOnce();
    expect(second.proceed).not.toHaveBeenCalled();
    expect(ledger.summary()).toMatchObject({
      queryAttempts: 2,
      protectedAbortAttempts: 1,
    });
    expect(() => ledger.healthy()).toThrow('budget');
  });

  it('enforces the diagnostic three-query global cap before a fourth request even across phases', async () => {
    const { ledger, send } = await harness(3);
    for (let index = 0; index < 3; index++) {
      ledger.phase('initial-' + index, 1, { orders: 1 });
      expect((await send(request(queryURL))).proceed).toHaveBeenCalledOnce();
    }
    ledger.phase('later', 1, { orders: 1 });
    const fourth = await send(request(queryURL));
    expect(fourth.abort).toHaveBeenCalledOnce();
    expect(fourth.proceed).not.toHaveBeenCalled();
    expect(() => ledger.healthy()).toThrow('budget');
  });

  it.each(['budget', 'request-failure'] as const)(
    'persists FAIL before rejecting a late %s observed during final drain',
    async (late) => {
      const { ledger, send, events } = await harness(3);
      ledger.phase('initial', 3, { orders: 3 });
      const req = Object.assign(request(queryURL), {
        failure: () => ({ errorText: 'net::ERR_ABORTED' }),
      });
      await send(req);
      if (late === 'budget') {
        await send(request(queryURL));
        await send(request(queryURL));
      }
      const receipt: Record<string, unknown> = { status: 'PASS' };
      vi.spyOn(ledger, 'drain').mockImplementationOnce(async () => {
        if (late === 'budget') await send(request(queryURL));
        else events.emit('requestfailed', req);
      });
      const persist = vi.fn(async () => {
        expect(receipt['status']).toBe('FAIL');
        expect(receipt['violations']).not.toEqual([]);
        expect(receipt['summary']).toMatchObject(
          late === 'budget'
            ? { queryAttempts: 4, protectedAbortAttempts: 1 }
            : { queryFailed: 1 },
        );
      });
      await expect(
        finalizeShowcaseMeasurement(ledger, receipt, persist),
      ).rejects.toThrow(late === 'budget' ? 'budget' : 'Query failed');
      expect(persist).toHaveBeenCalledOnce();
    },
  );

  it.each(['budget', 'request-failure'] as const)(
    'corrects a tentative receipt and rejects a late %s during persistence',
    async (late) => {
      const { ledger, send, events } = await harness(3);
      ledger.phase('initial', 3, { orders: 3 });
      const receipt: Record<string, unknown> = { status: 'PASS' };
      const persisted: Record<string, unknown>[] = [];
      const persist = vi.fn(async () => {
        persisted.push(
          JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>,
        );
        if (persisted.length !== 1) return;
        if (late === 'budget')
          for (let index = 0; index < 4; index++) await send(request(queryURL));
        else {
          const req = Object.assign(request(queryURL), {
            failure: () => ({ errorText: 'net::ERR_ABORTED' }),
          });
          await send(req);
          events.emit('requestfailed', req);
        }
      });
      await expect(
        finalizeShowcaseMeasurement(ledger, receipt, persist),
      ).rejects.toThrow(late === 'budget' ? 'budget' : 'Query failed');
      expect(persist).toHaveBeenCalledTimes(2);
      expect(persisted[0]['status']).toBe('PASS');
      expect(persisted[1]).toMatchObject({
        status: 'FAIL',
        summary:
          late === 'budget'
            ? { queryAttempts: 4, protectedAbortAttempts: 1 }
            : { queryFailed: 1 },
      });
      expect(persisted[1]['violations']).not.toEqual([]);
    },
  );

  it.each([200, 503])(
    'retains response status %s before an aborted body and still rejects the failure',
    async (status) => {
      const { ledger, send, events } = await harness();
      ledger.phase('initial', 1, { orders: 1 });
      const req = Object.assign(request(queryURL), {
        failure: () => ({ errorText: 'net::ERR_ABORTED' }),
      });
      await send(req);
      events.emit('response', {
        request: () => req,
        status: () => status,
        headers: () => ({
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': 'never-record-this-secret',
        }),
      });
      expect(ledger.rows[0]).toMatchObject({
        status,
        responseContentType: 'application/json',
        outcome: 'pending',
      });
      expect(ledger.rows[0].responseReceivedAtMs).toBeTypeOf('number');
      events.emit('requestfailed', req);
      expect(ledger.rows[0]).toMatchObject({
        status,
        outcome: 'failed',
        failure: 'net::ERR_ABORTED',
      });
      expect(ledger.summary()).toMatchObject({
        queryFailed: 1,
        queryFinished: 0,
        querySizeMissing: 1,
      });
      expect(() => ledger.healthy()).toThrow('Query failed: orders');
      expect(JSON.stringify(ledger.rows)).not.toContain(
        'never-record-this-secret',
      );
      expect(JSON.stringify(ledger.rows)).not.toContain('set-cookie');
    },
  );

  it('retains a failure without response headers without inventing status or successful bytes', async () => {
    const { ledger, send, events } = await harness();
    ledger.phase('initial', 1, { orders: 1 });
    const req = Object.assign(request(queryURL), {
      failure: () => ({ errorText: 'net::ERR_FAILED' }),
    });
    await send(req);
    events.emit('requestfailed', req);
    expect(ledger.rows[0].status).toBeUndefined();
    expect(ledger.rows[0].responseReceivedAtMs).toBeUndefined();
    expect(ledger.summary()).toMatchObject({
      queryFailed: 1,
      encodedQueryResponseBodyBytes: 0,
      querySizeMissing: 1,
    });
    expect(() => ledger.healthy()).toThrow('Query failed: orders');
  });

  it('enforces the absolute 12-query cap even if a phase allows more', async () => {
    const { ledger, send } = await harness();
    ledger.phase('bounded', 20, { orders: 20 });
    for (let index = 0; index < 12; index++)
      expect((await send(request(queryURL))).proceed).toHaveBeenCalledOnce();
    const refused = await send(request(queryURL));
    expect(refused.abort).toHaveBeenCalledOnce();
    expect(refused.proceed).not.toHaveBeenCalled();
    expect(ledger.summary().queryAttempts).toBe(13);
  });

  it.each([
    [
      'https://api.sneat.cloud/v0/datatug/projects/create_project',
      'project-write',
    ],
    [
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=not-recorded',
      'auth',
    ],
    ['https://unknown.test/write?secret=not-recorded', 'other-write'],
  ])(
    'blocks %s and records attempts without parameters, headers or bodies',
    async (url, kind) => {
      const { ledger, send } = await harness();
      const result = await send(request(url, 'POST', 'private-fixture-body'));
      expect(result.abort).toHaveBeenCalledOnce();
      expect(result.proceed).not.toHaveBeenCalled();
      expect(ledger.rows[0]).toMatchObject({
        kind,
        protectedAbort: 'forbidden-write-or-auth',
      });
      expect(JSON.stringify(ledger.rows)).not.toContain('not-recorded');
      expect(JSON.stringify(ledger.rows)).not.toContain('private-fixture-body');
    },
  );

  it('refuses unknown queries, wrong source/body contracts, proxy use and SQLite/WASM requests', async () => {
    for (const req of [
      request(queryURL, 'POST', 'unknown'),
      request('https://cloud.openvaultdb.com/v1/databases/northwind/dtql'),
      request(queryURL, 'POST', ordersQuery),
      request(
        'https://datatug.app/__datatug_public_ovdb/demodb/v1/databases/northwind/dtql',
      ),
      request('https://datatug.app/database.sqlite', 'GET'),
      request('https://datatug.app/worker.wasm', 'GET'),
    ]) {
      const { ledger, send } = await harness();
      ledger.phase('initial', 1, { orders: 1 });
      const result = await send(req);
      expect(result.abort).toHaveBeenCalledOnce();
      expect(result.proceed).not.toHaveBeenCalled();
      expect(ledger.violations.length).toBeGreaterThan(0);
    }
  });
});
