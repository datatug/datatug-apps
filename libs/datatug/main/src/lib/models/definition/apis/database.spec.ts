import { describe, expect, it } from 'vitest';
import {
  DB_SERVER_ID_NO_HOST,
  getDbServerFromId,
  getDbServerId,
  IDbServer,
} from './database';

/**
 * S160 — `getDbServerFromId()`'s `port: +v[0]` off-by-one (`v[0]` is the
 * HOST segment, always `NaN`) meant a server's Port row never rendered
 * (`dbserver-page.component.html`'s `@if (dbServer()?.port)` is falsy for
 * `NaN`) for any server whose id contained a port. Fixed to `+v[1]`.
 * `getDbServerId()` is the new inverse used by
 * `ServersPageComponent.goDbServer()` to build the route segment in the
 * first place, including the host-less placeholder
 * ({@link DB_SERVER_ID_NO_HOST}) the GitHub demo project's sqlite3 server
 * needs (it declares no `host` at all — sqlite3 is file-based).
 */
describe('getDbServerFromId', () => {
  it('parses a bare host with no port', () => {
    expect(getDbServerFromId('sqlserver', 'localhost')).toEqual({
      driver: 'sqlserver',
      host: 'localhost',
    });
  });

  it('parses host:port, taking the PORT segment (v[1]) for `port` — not the host segment (v[0])', () => {
    expect(getDbServerFromId('sqlserver', 'localhost:1433')).toEqual({
      driver: 'sqlserver',
      host: 'localhost',
      port: 1433,
    });
  });

  it('never returns NaN for a numeric-looking host paired with a port (the exact regression shape)', () => {
    const result = getDbServerFromId('sqlserver', '10.0.0.5:5432');
    expect(result.port).toBe(5432);
    expect(Number.isNaN(result.port)).toBe(false);
  });

  it('maps the host-less placeholder back to an empty host', () => {
    expect(getDbServerFromId('sqlite3', DB_SERVER_ID_NO_HOST)).toEqual({
      driver: 'sqlite3',
      host: '',
    });
  });
});

describe('getDbServerId', () => {
  it('returns the bare host when there is no port', () => {
    const dbServer: IDbServer = { driver: 'sqlserver', host: 'localhost' };
    expect(getDbServerId(dbServer)).toBe('localhost');
  });

  it('returns host:port when a port is set', () => {
    const dbServer: IDbServer = {
      driver: 'sqlserver',
      host: 'localhost',
      port: 1433,
    };
    expect(getDbServerId(dbServer)).toBe('localhost:1433');
  });

  it('returns the host-less placeholder for an empty host (the GitHub demo project\'s sqlite3 server)', () => {
    const dbServer: IDbServer = { driver: 'sqlite3', host: '' };
    expect(getDbServerId(dbServer)).toBe(DB_SERVER_ID_NO_HOST);
  });

  it('returns the host-less placeholder for a whitespace-only host', () => {
    const dbServer: IDbServer = { driver: 'sqlite3', host: '   ' };
    expect(getDbServerId(dbServer)).toBe(DB_SERVER_ID_NO_HOST);
  });

  it('round-trips through getDbServerFromId for a host+port server', () => {
    const dbServer: IDbServer = {
      driver: 'sqlserver',
      host: 'localhost',
      port: 1433,
    };
    const id = getDbServerId(dbServer);
    expect(getDbServerFromId(dbServer.driver, id)).toEqual(dbServer);
  });

  it('round-trips through getDbServerFromId for the host-less placeholder', () => {
    const dbServer: IDbServer = { driver: 'sqlite3', host: '' };
    const id = getDbServerId(dbServer);
    expect(getDbServerFromId(dbServer.driver, id)).toEqual(dbServer);
  });
});
