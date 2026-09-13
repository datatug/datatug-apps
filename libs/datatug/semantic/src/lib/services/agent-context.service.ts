import { HttpClient } from '@angular/common/http';
import {
  Injectable,
  Signal,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Observable, finalize, map, shareReplay, tap } from 'rxjs';
import { AgentInfo } from '../../contract/types';
import { decodeAgentInfo } from '../../contract/decoders';
import { DATATUG_AGENT_BASE_URL } from '../tokens/datatug-agent-base-url.token';

/** A cached, reactive identity view for one explicit DataTug agent base URL. */
export interface AgentContextHandle {
  readonly info: Signal<AgentInfo | undefined>;
  readonly securityContextId: Signal<string | undefined>;
  refresh(): Observable<AgentInfo>;
}

interface CachedAgentContext {
  readonly baseUrl: string;
  readonly infoSignal: WritableSignal<AgentInfo | undefined>;
  readonly handle: AgentContextHandle;
  refreshing?: Observable<AgentInfo>;
}

/**
 * Owns `GET /datatug/agent-info` and the `securityContextId` every scoped call in the
 * appendix must carry (datatug/datatug: spec/features/core-investigation-loop/
 * api-contract.md "Scope and identity"). An ID is a staleness check, never
 * authentication — the server responds `STALE_CONTEXT` after a principal/policy-session
 * change, which callers handle by calling {@link refresh} again (a fresh ID) and clearing
 * any principal-scoped Investigation Context state (`InvestigationContextService.clear()`)
 * before retrying. Plan Task 12 cuts this over only as far as the wire boundary needs;
 * full typed-context isolation (conflicts, late-response discard, reactive store-change
 * binding) is Task 15's job.
 *
 * Deliberately separate from `libs/datatug/main`'s pre-existing `AgentStateService`
 * (`{version, uptimeMinutes}`, a 10s "is an agent even running" poller for UI display) —
 * that concern predates and is orthogonal to the normative contract's `AgentInfo` shape
 * (`principal`, `securityContextId`, `projects`, `capabilities`). Unifying the two agent-info
 * fetchers into one is flagged as a follow-up, not done here, to avoid widening this cut-over
 * into an unrelated "is the agent running" UX (see this stream's PR body inventory).
 */
@Injectable({ providedIn: 'root' })
export class AgentContextService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(DATATUG_AGENT_BASE_URL);
  private readonly contexts = new Map<string, CachedAgentContext>();
  private readonly defaultContext = this.contextFor(this.baseUrl);

  /** `undefined` until the first {@link refresh} resolves. */
  readonly info: Signal<AgentInfo | undefined> = this.defaultContext.info;

  readonly securityContextId: Signal<string | undefined> =
    this.defaultContext.securityContextId;

  /**
   * Returns one stable reactive handle per normalized agent base URL. The first
   * lookup starts a best-effort `agent-info` fetch, so a cold deep-link can wait
   * for the identity belonging to the same agent it will call.
   */
  contextFor(baseUrl: string): AgentContextHandle {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const cached = this.contexts.get(normalizedBaseUrl);
    if (cached) {
      return cached.handle;
    }
    const infoSignal = signal<AgentInfo | undefined>(undefined);
    const handle: AgentContextHandle = {
      info: infoSignal.asReadonly(),
      securityContextId: computed(() => infoSignal()?.securityContextId),
      refresh: () => this.refreshKnownContext(normalizedBaseUrl),
    };
    const state: CachedAgentContext = {
      baseUrl: normalizedBaseUrl,
      infoSignal,
      handle,
    };
    this.contexts.set(normalizedBaseUrl, state);
    this.refreshContext(state).subscribe({ error: () => undefined });
    return handle;
  }

  /** `GET /datatug/agent-info` — call again after a `STALE_CONTEXT` response to obtain a
   * fresh `securityContextId` before retrying the failed call. */
  refresh(baseUrl = this.baseUrl): Observable<AgentInfo> {
    return this.contextFor(baseUrl).refresh();
  }

  private refreshKnownContext(baseUrl: string): Observable<AgentInfo> {
    const state = this.contexts.get(baseUrl);
    if (!state) {
      throw new Error(`No cached DataTug agent context for ${baseUrl}.`);
    }
    return this.refreshContext(state);
  }

  private refreshContext(state: CachedAgentContext): Observable<AgentInfo> {
    if (state.refreshing) {
      return state.refreshing;
    }
    const request = this.http.get<unknown>(`${state.baseUrl}/agent-info`).pipe(
      map((raw) => decodeAgentInfo(raw)),
      tap((info) => state.infoSignal.set(info)),
      finalize(() => {
        if (state.refreshing === request) {
          state.refreshing = undefined;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    state.refreshing = request;
    return request;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/u, '');
  if (!normalized) {
    throw new Error('DataTug agent base URL is required.');
  }
  return normalized;
}
