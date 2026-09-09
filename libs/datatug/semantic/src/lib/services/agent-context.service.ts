import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { AgentInfo } from '../../contract/types';
import { decodeAgentInfo } from '../../contract/decoders';
import { DATATUG_AGENT_BASE_URL } from '../tokens/datatug-agent-base-url.token';

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

  private readonly infoSignal = signal<AgentInfo | undefined>(undefined);

  /** `undefined` until the first {@link refresh} resolves. */
  readonly info: Signal<AgentInfo | undefined> = this.infoSignal.asReadonly();

  readonly securityContextId: Signal<string | undefined> = computed(
    () => this.infoSignal()?.securityContextId,
  );

  constructor() {
    // Best-effort initial fetch so `securityContextId()` is populated as soon as
    // possible; a scoped call made before this resolves has nothing to send yet and
    // should treat an empty securityContextId the same as any other precondition it
    // waits on (mirrors how `project`/`envId` are awaited today).
    this.refresh().subscribe({ error: () => undefined });
  }

  /** `GET /datatug/agent-info` — call again after a `STALE_CONTEXT` response to obtain a
   * fresh `securityContextId` before retrying the failed call. */
  refresh(): Observable<AgentInfo> {
    return this.http.get<unknown>(`${this.baseUrl}/agent-info`).pipe(
      map((raw) => decodeAgentInfo(raw)),
      tap((info) => this.infoSignal.set(info)),
    );
  }
}
