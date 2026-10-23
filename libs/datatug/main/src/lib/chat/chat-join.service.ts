import { Injectable, inject } from '@angular/core';
import { parseTugQLYaml } from '@dalgo/core';
import { chatTugqlYaml, chatSQLite } from './chat-query-format';
import { ChatSessionService } from './chat-session.service';
import { ChatMetrics, ChatTurn, CHINOOK_SCHEMA } from './chat.types';
import { ChatJoinCandidate, deriveChatJoin, discoverChatJoinCandidates } from './chat-joins';
import { ChinookChatDataService } from './chinook-chat-data.service';

/** The single application path used by the candidate UI and the AI action. */
@Injectable({ providedIn: 'root' })
export class ChatJoinService {
  private readonly sessions = inject(ChatSessionService);
  private readonly data = inject(ChinookChatDataService);

  candidates(tugql: string): readonly ChatJoinCandidate[] {
    const query = parseTugQLYaml(tugql, CHINOOK_SCHEMA, { maxLimit: 1000 });
    return discoverChatJoinCandidates(query);
  }

  async apply(
    scope: string, sessionId: string, parentRecordSetId: string, candidateId: string,
    pendingTurnId: string, dataScope: string,
    aiMetrics: Omit<ChatMetrics, 'queryMs'> = { requestBytes: 0, responseBytes: 0, interpretMs: 0 },
  ): Promise<ChatTurn> {
    const parent = await this.sessions.joinParent(scope, sessionId, parentRecordSetId);
    const parsed = parseTugQLYaml(parent.query.tugql, CHINOOK_SCHEMA, { maxLimit: 1000 });
    const derived = deriveChatJoin(parsed, candidateId, CHINOOK_SCHEMA);
    const started = performance.now();
    const { rows, query } = await this.data.query(dataScope, derived.tugql);
    return this.sessions.completeQuery(scope, sessionId, pendingTurnId, {
      tugql: derived.tugql, generatedTugql: derived.tugql,
      parentRecordSetId, tugqlYaml: chatTugqlYaml(query), sql: chatSQLite(query),
      rows, columns: rows.length ? Object.keys(rows[0]) : derived.query.columns?.map((column) =>
        column.as || (column.expression?.kind === 'field' ? column.expression.field.field : '')).filter(Boolean) || [],
      metrics: { ...aiMetrics, queryMs: performance.now() - started },
      source: `${scope}/chinook`, join: derived.lineage,
    });
  }
}
