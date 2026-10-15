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
  private pending: AgentLinkCode | undefined = inject(AGENT_LINK_CODE, {
    optional: true,
  }) ?? undefined;
  private exchanging?: Observable<string | undefined>;
  private readonly memory = new Map<string, string>();

  /**
   * The session token to send to the agent at origin: the one held, else the token the pending one-time code of
   * that agent is exchanged for (once, shared by every request that waits for it), else undefined (the request goes
   * without one, and an agent that needs one answers 401).
   *
   * An exchange the agent refuses (the code was used, expired or tampered) fails with a 401, so the page shows
   * `link-expired`; an agent that is not reachable fails with status 0 and keeps the code for a retry; an agent too
   * old to have the exchange route (404) needs no token, and the request goes without one.
   */
  tokenFor(origin: string): Observable<string | undefined> {
    const held = this.read(origin);
    if (held) {
      return of(held);
    }
    const pending = this.pending;
    if (!pending || pending.origin !== origin) {
      return of(undefined);
    }
    this.exchanging ??= this.exchange(pending).pipe(shareReplay(1));
    return this.exchanging;
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
          this.pending = undefined;
          this.exchanging = undefined;
          this.write(pending.origin, token);
        }),
        catchError((err: unknown) => {
          this.exchanging = undefined;
          const status = err instanceof HttpErrorResponse ? err.status : -1;
          if (status === 0) {
            // Not reached: the code is not spent, keep it for "Check again".
            return throwError(() => err);
          }
          this.pending = undefined;
          if (status === 404) {
            // An agent that predates the session token has no exchange route and needs no token.
            return of(undefined);
          }
          // Refused: used, expired, tampered or malformed. Never echo what the agent said.
          return throwError(
            () => new HttpErrorResponse({ status: 401, url: pending.origin }),
          );
        }),
      );
  }

  private read(origin: string): string | undefined {
    const inMemory = this.memory.get(origin);
    if (inMemory) {
      return inMemory;
    }
    try {
      return localStorage.getItem(TOKEN_KEY_PREFIX + origin) || undefined;
    } catch {
      return undefined;
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
