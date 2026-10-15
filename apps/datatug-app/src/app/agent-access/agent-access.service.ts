import {
  HttpBackend,
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { Injectable, InjectionToken, Provider, inject } from '@angular/core';
import {
  Observable,
  catchError,
  map,
  of,
  shareReplay,
  tap,
  throwError,
} from 'rxjs';
import { AgentLinkCode } from './agent-link-code';

/** The one-time code the page was opened with (read by `takeAgentLinkCode()` in `main.ts`), if any. */
export const AGENT_LINK_CODE = new InjectionToken<AgentLinkCode | undefined>(
  'AGENT_LINK_CODE',
);

export function provideAgentLinkCode(code: AgentLinkCode | undefined): Provider {
  return { provide: AGENT_LINK_CODE, useValue: code };
}

/** The route (under the agent origin) that trades a one-time code for the session token (datatug-cli
 * `agentaccess.ExchangePath`). */
export const AGENT_SESSION_EXCHANGE_PATH = '/datatug/session/exchange';

/** localStorage key prefix of a session token, one per agent origin. */
const TOKEN_KEY_PREFIX = 'datatug.agent-session:';
/** sessionStorage key of a one-time code not yet exchanged (the agent was not reachable), so a reload of the tab
 * after starting the agent can still exchange it. Removed once the code is spent or refused. */
const PENDING_CODE_KEY = 'datatug.agent-link-code';

/**
 * The session token of each local agent this browser holds (Feature claude-mod-web-links, REQ:daemon-access and
 * REQ:link-freshness): the one-time code of a link is exchanged once for the agent's session token, which is kept per
 * agent origin, so a second click on a link (whose code is then spent) still opens the page. The token is sent only
 * to the loopback origin it was issued by (`Authorization: Bearer`), never put in an address, a log or telemetry,
 * and forgotten when the agent refuses it (the agent restarted with a new secret).
 *
 * localStorage, not sessionStorage: a card's link opens a new tab, which has its own sessionStorage. Storage that
 * is not available (a private window, blocked site data) leaves the token in memory for this page only.
 */
@Injectable({ providedIn: 'root' })
export class AgentAccessService {
  private readonly http = new HttpClient(inject(HttpBackend));
  private pending: AgentLinkCode | undefined =
    inject(AGENT_LINK_CODE, { optional: true }) ?? readPendingCode();
  private exchanging?: Observable<string | undefined>;
  private readonly memory = new Map<string, string>();

  /**
   * The session token to send to the agent at origin. A pending one-time code of that agent is exchanged first
   * (once, shared by every request that waits for it), even when a token is held: a held token may be from before
   * the agent restarted (it makes a new secret on every start), and the fresh link's code is what opens the page.
   * With no pending code, the token held; else undefined (the request goes without one, and an agent that needs one
   * answers 401).
   *
   * An exchange the agent refuses (the code was used, expired or tampered) falls back to the token held, if any (a
   * second click on a spent link, or another tab that exchanged the same code first), else fails with a 401, so the
   * page shows `link-expired`. An agent that is not reachable fails with status 0 and keeps the code for a retry; an
   * agent too old to have the exchange route (404) needs no token, and the request goes without one.
   */
  tokenFor(origin: string): Observable<string | undefined> {
    const pending = this.pending;
    if (pending && pending.origin === origin) {
      this.exchanging ??= this.exchange(pending).pipe(shareReplay(1));
      return this.exchanging;
    }
    return of(this.read(origin));
  }

  /** Forgets the token the agent at origin refused, unless a newer one replaced it meanwhile. */
  forget(origin: string, token: string): void {
    if (this.read(origin) !== token) {
      return;
    }
    this.memory.delete(origin);
    try {
      localStorage.removeItem(TOKEN_KEY_PREFIX + origin);
    } catch {
      // storage not available: the memory copy is gone already
    }
  }

  private exchange(pending: AgentLinkCode): Observable<string | undefined> {
    return this.http
      .post<{ token?: unknown }>(
        pending.origin + AGENT_SESSION_EXCHANGE_PATH,
        { code: pending.code },
        { headers: new HttpHeaders({ 'Content-Type': 'application/json' }) },
      )
      .pipe(
        map((response) => {
          const token = response?.token;
          if (typeof token !== 'string' || !token) {
            throw new HttpErrorResponse({ status: 401, url: pending.origin });
          }
          return token;
        }),
        tap((token) => {
          this.settle();
          this.write(pending.origin, token);
        }),
        catchError((err: unknown) => {
          const status = err instanceof HttpErrorResponse ? err.status : -1;
          if (status === 0) {
            // Not reached: the code is not spent, keep it (also across a reload of this tab) for "Check again".
            this.exchanging = undefined;
            writePendingCode(pending);
            return throwError(() => err);
          }
          this.settle();
          if (status === 404) {
            // An agent that predates the session token has no exchange route and needs no token.
            return of(undefined);
          }
          // Refused: used, expired, tampered or malformed. A token held (from an earlier click, or written by
          // another tab that spent this code first) still opens the page. Never echo what the agent said.
          const held = this.read(pending.origin, true);
          return held
            ? of(held)
            : throwError(
                () => new HttpErrorResponse({ status: 401, url: pending.origin }),
              );
        }),
      );
  }

  /** The code is spent or refused: no exchange is pending any more, here or after a reload. */
  private settle(): void {
    this.pending = undefined;
    this.exchanging = undefined;
    writePendingCode(undefined);
  }

  /** The token held for origin; `fromStorage` reads what another tab may have written since. */
  private read(origin: string, fromStorage = false): string | undefined {
    const inMemory = this.memory.get(origin);
    if (inMemory && !fromStorage) {
      return inMemory;
    }
    try {
      return localStorage.getItem(TOKEN_KEY_PREFIX + origin) || inMemory;
    } catch {
      return inMemory;
    }
  }

  private write(origin: string, token: string): void {
    this.memory.set(origin, token);
    try {
      localStorage.setItem(TOKEN_KEY_PREFIX + origin, token);
    } catch {
      // storage not available: the token lives in memory for this page only
    }
  }
}

function readPendingCode(): AgentLinkCode | undefined {
  try {
    const raw = sessionStorage.getItem(PENDING_CODE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AgentLinkCode>) : undefined;
    return typeof parsed?.origin === 'string' && typeof parsed.code === 'string'
      ? { origin: parsed.origin, code: parsed.code }
      : undefined;
  } catch {
    return undefined;
  }
}

function writePendingCode(code: AgentLinkCode | undefined): void {
  try {
    if (code) {
      sessionStorage.setItem(PENDING_CODE_KEY, JSON.stringify(code));
    } else {
      sessionStorage.removeItem(PENDING_CODE_KEY);
    }
  } catch {
    // storage not available: the code is kept in memory for this page only
  }
}
