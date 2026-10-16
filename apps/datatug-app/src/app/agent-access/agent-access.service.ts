import {
  FetchBackend,
  HttpClient,
  HttpErrorResponse,
} from '@angular/common/http';
import { Injectable, InjectionToken, Provider, inject } from '@angular/core';
import {
  Observable,
  catchError,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { AgentLinkCode } from './agent-link-code';

/** The one-time code read from the URL fragment before telemetry or routing starts. */
export const AGENT_LINK_CODE = new InjectionToken<AgentLinkCode | undefined>(
  'AGENT_LINK_CODE',
);
/** Resolves the explicit loopback agent selected by the current `/store/<id>` route for each request. */
export const AGENT_ACTIVE_ORIGIN = new InjectionToken<() => string | undefined>(
  'AGENT_ACTIVE_ORIGIN',
);

export function provideAgentLinkCode(
  code: AgentLinkCode | undefined,
): Provider {
  return { provide: AGENT_LINK_CODE, useValue: code };
}

export const AGENT_SESSION_EXCHANGE_PATH = '/datatug/session/exchange';
const TOKEN_KEY_PREFIX = 'datatug.agent-session:';
const LEGACY_PENDING_CODE_KEY = 'datatug.agent-link-code';

/**
 * The one-time code of a fresh link is exchanged once for a session token held per agent origin. Successful tokens
 * stay in localStorage so another tab opened from a second link can reuse them; a fresh code still takes precedence
 * after an agent restart. Codes are never persisted or replayed after an exchange attempt, because a lost response
 * does not prove the server did not consume the code. Open a fresh agent link to reconnect after an uncertain attempt.
 */
@Injectable({ providedIn: 'root' })
export class AgentAccessService {
  /** Use FetchBackend directly so an exchange can forbid redirects and omit ambient cookies. */
  private readonly http = new HttpClient(inject(FetchBackend));
  private pending: AgentLinkCode | undefined =
    inject(AGENT_LINK_CODE, { optional: true }) ?? undefined;
  private exchanging?: Observable<string | undefined>;
  private readonly memory = new Map<string, string>();

  constructor() {
    // Older builds persisted one-time codes for retries. Scrub them without reading or replaying them.
    try {
      sessionStorage.removeItem(LEGACY_PENDING_CODE_KEY);
    } catch {
      // session storage may be unavailable
    }
  }

  tokenFor(origin: string): Observable<string | undefined> {
    const pending = this.pending;
    if (pending && pending.origin === origin) {
      this.exchanging ??= this.exchange(pending).pipe(shareReplay(1));
      return this.exchanging;
    }
    return of(this.read(origin));
  }

  /** Forgets the token the agent refused, unless a newer token replaced it meanwhile. */
  forget(origin: string, token: string): void {
    if (this.memory.get(origin) === token) this.memory.delete(origin);
    try {
      const key = TOKEN_KEY_PREFIX + origin;
      if (localStorage.getItem(key) === token) localStorage.removeItem(key);
    } catch {
      // memory and persistent storage are guarded independently
    }
  }

  private exchange(pending: AgentLinkCode): Observable<string | undefined> {
    return this.http
      .post<{ token?: unknown }>(
        pending.origin + AGENT_SESSION_EXCHANGE_PATH,
        { code: pending.code },
        {
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
        },
      )
      .pipe(
        switchMap((body) => {
          const token = body?.token;
          if (typeof token !== 'string' || !token)
            throw new HttpErrorResponse({ status: 401, url: pending.origin });
          return of(token);
        }),
        tap((token) => {
          this.settle();
          if (token) this.write(pending.origin, token);
        }),
        catchError((err: unknown) => {
          const status = err instanceof HttpErrorResponse ? err.status : 401;
          // Any failed response may follow a consumed code; never replay it. A 401 then surfaces as the existing
          // link-expired/reconnect state, while a held token still preserves the already-supported second-tab flow.
          this.settle();
          if (status === 404) return of(undefined); // Older agents have no exchange endpoint.
          const held = this.read(pending.origin, true);
          return held
            ? of(held)
            : throwError(
                () =>
                  new HttpErrorResponse({ status: 401, url: pending.origin }),
              );
        }),
      );
  }

  private settle(): void {
    this.pending = undefined;
    this.exchanging = undefined;
  }

  private read(origin: string, fromStorage = false): string | undefined {
    const inMemory = this.memory.get(origin);
    if (inMemory && !fromStorage) return inMemory;
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
      /* memory is the page fallback */
    }
  }
}
