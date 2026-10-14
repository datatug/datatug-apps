import { Injectable, inject } from '@angular/core';
import { ChatSessionService } from '../chat/chat-session.service';
import { InvestigationStorage } from '../chat/investigation/investigation-storage';
import { agentBaseUrl } from '../services/repo/agent-url';
import { IProjectRef } from '../core/project-context';
import { ContextCapabilities, ContextLegacyImport, ContextSubject, ContextValue, SessionScope, contextScopeKey } from './session-context-contract';
import { decodeFact, type Fact } from '@sneat/datatug-semantic';

const LEGACY_CONTEXT_PREFIX = 'datatug.investigationContext.v2.';
const MAX_CONTEXT_ENTRIES = 400;
const MAX_LEGACY_MESSAGES = 1000;
const MAX_MESSAGE_LENGTH = 100_000;

export interface LegacyImportEntryPreview {
  readonly id: string;
  readonly label: string;
  readonly valueLabel: string;
  readonly subject?: ContextSubject;
  readonly value?: ContextValue;
  readonly createdAt?: string;
  readonly blockedReason?: string;
}

export interface LegacyConversationPreview {
  readonly id: string;
  readonly title: string;
  readonly kind: 'chat' | 'investigation';
  readonly createdAt: string;
  readonly messages: ContextLegacyImport['messages'];
  readonly omittedCount: number;
  readonly warning?: string;
}

export interface LegacyImportPreview {
  readonly entries: readonly LegacyImportEntryPreview[];
  readonly conversations: readonly LegacyConversationPreview[];
  readonly warnings: readonly string[];
}

type ImportableLegacyEntry = LegacyImportEntryPreview & { readonly subject: ContextSubject; readonly value: ContextValue };
const isImportableEntry = (entry: LegacyImportEntryPreview): entry is ImportableLegacyEntry =>
  !!entry.subject && !!entry.value && !entry.blockedReason;

/** Reads the previous browser stores without changing them or loading saved result rows. */
@Injectable({ providedIn: 'root' })
export class LegacyContextImportService {
  private readonly chatSessions = inject(ChatSessionService);
  private readonly investigations = inject(InvestigationStorage);

  async preview(project: IProjectRef, capabilities: ContextCapabilities, targetScope: SessionScope): Promise<LegacyImportPreview> {
    const warnings: string[] = [];
    const entries = this.readLegacyContext(project, capabilities, targetScope, warnings);
    const conversations: LegacyConversationPreview[] = [];
    const sourceScope = JSON.stringify([project.storeId, project.projectId]);
    try {
      const sessions = await this.chatSessions.list(sourceScope);
      conversations.push(...await this.readConversations(this.chatSessions, sessions, 'chat', sourceScope));
    } catch {
      warnings.push('Saved chat history could not be read from this browser.');
    }
    try {
      const investigationStore = await this.investigations.sessions();
      if (investigationStore) {
        conversations.push(...await this.readConversations(investigationStore,
          await investigationStore.list(sourceScope), 'investigation', sourceScope));
      }
    } catch {
      warnings.push('Saved investigation history could not be read from this browser.');
    }
    conversations.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
    return { entries, conversations, warnings };
  }

  async createPayload(
    project: IProjectRef,
    capabilities: ContextCapabilities,
    targetScope: SessionScope,
    preview: LegacyImportPreview,
    selectedConversationIds: readonly string[],
    includeContext: boolean,
  ): Promise<ContextLegacyImport> {
    const selected = new Set(selectedConversationIds);
    const entries = includeContext ? preview.entries.filter(isImportableEntry) : [];
    const messages = preview.conversations.filter((conversation) => selected.has(conversation.id)).flatMap((conversation) => conversation.messages);
    if (entries.length > MAX_CONTEXT_ENTRIES || messages.length > MAX_LEGACY_MESSAGES || messages.some((message) => message.text.length > MAX_MESSAGE_LENGTH)) {
      throw new Error('The selected legacy content exceeds the import size limit. Choose fewer records.');
    }
    if (!entries.length && !messages.length) throw new Error('Select at least one portable context entry or saved conversation.');
    const sourceParts = [project.storeId, project.projectId, capabilities.databaseId, capabilities.projectId,
      contextScopeKey(targetScope), ...(includeContext ? preview.entries.filter((entry) => entry.subject || entry.blockedReason).map((entry) => entry.id) : []),
      ...[...selected].sort()];
    const sourceId = `legacy_${await sha256(sourceParts.join('\u0000'))}`;
    const conversationNames = preview.conversations.filter((conversation) => selected.has(conversation.id)).map((item) => item.title);
    const title = conversationNames.length === 1 ? `Imported: ${conversationNames[0]}` : includeContext ? 'Imported legacy context' : 'Imported chat history';
    const payload: ContextLegacyImport = {
      sourceId,
      title: title.slice(0, 100),
      scope: targetScope,
      entries: entries.map(({ id, label, subject, value, createdAt }) => ({ id, alias: label, subject, value, ...(createdAt ? { createdAt } : {}) })),
      messages,
    };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 4 * 1024 * 1024) throw new Error('The selected legacy content exceeds the total import limit. Choose fewer records.');
    return payload;
  }

  private readLegacyContext(
    project: IProjectRef, capabilities: ContextCapabilities, targetScope: SessionScope, warnings: string[],
  ): readonly LegacyImportEntryPreview[] {
    let legacyStorage: Storage;
    try { legacyStorage = globalThis.sessionStorage; }
    catch { warnings.push('Legacy Investigation Context is unavailable in this browser.'); return []; }
    const scopedKey = `${LEGACY_CONTEXT_PREFIX}${[
      agentBaseUrl(project.storeId), project.projectId, targetScope.environmentId, targetScope.identityDomain,
    ].join('\u0000')}`;
    let raw: string | null;
    try { raw = legacyStorage.getItem(scopedKey); }
    catch { warnings.push('Legacy Investigation Context could not be read from this browser.'); return []; }
    if (!raw) return [];
    let decoded: unknown;
    try { decoded = JSON.parse(raw) as unknown; }
    catch { warnings.push('Legacy Investigation Context contains damaged saved data.'); return []; }
    if (!Array.isArray(decoded)) { warnings.push('Legacy Investigation Context has an unsupported format.'); return []; }
    if (decoded.length > MAX_CONTEXT_ENTRIES) warnings.push(`Only the first ${MAX_CONTEXT_ENTRIES} context entries can be previewed.`);
    return decoded.slice(0, MAX_CONTEXT_ENTRIES).map((candidate, index) => {
      try {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Saved item is not an object.');
        const rawItem = candidate as Record<string, unknown>;
        const { label, addedAt, role, layer, selectedForBinding, ...factFields } = rawItem;
        const fact = decodeFact(factFields) as Fact;
        const displayLabel = typeof label === 'string' && label.trim() ? label : `${fact.entity}.${fact.field}`;
        const stamp = typeof addedAt === 'string' && !Number.isNaN(Date.parse(addedAt)) ? addedAt : undefined;
        if (role !== undefined || layer !== undefined || selectedForBinding !== undefined) {
          return { id: `legacy-fact-${index}`, label: displayLabel, valueLabel: summarizeFact(fact), createdAt: stamp,
            blockedReason: 'Legacy role, overlay, or selection metadata needs explicit handling before import.' };
        }
        const subjectChoices = capabilities.subjects?.filter((choice) => contextScopeKey(choice.scope) === contextScopeKey(targetScope) &&
          choice.subject.conceptId === fact.entity && choice.subject.fieldId === fact.field) ?? [];
        if (subjectChoices.length !== 1) {
          return { id: `legacy-fact-${index}`, label: displayLabel, valueLabel: summarizeFact(fact), createdAt: stamp,
            blockedReason: subjectChoices.length ? 'More than one admitted field matches. Choose a mapping before import.' : 'No admitted field matches this legacy entity and field in the selected environment.' };
        }
        const value = toContextValue(fact);
        if (!value) return { id: `legacy-fact-${index}`, label: displayLabel, valueLabel: summarizeFact(fact), createdAt: stamp,
          blockedReason: `The ${fact.condition ?? '=='} condition cannot be represented in a Context Bag.` };
        return { id: `legacy-fact-${index}`, label: displayLabel, valueLabel: summarizeFact(fact), subject: subjectChoices[0].subject,
          value, createdAt: stamp };
      } catch {
        return { id: `legacy-fact-${index}`, label: `Context entry ${index + 1}`, valueLabel: 'Unsupported saved value',
          blockedReason: 'This saved value has an unsupported or invalid format.' };
      }
    });
  }

  private async readConversations(store: ChatSessionService, sessions: Awaited<ReturnType<ChatSessionService['list']>>,
    kind: LegacyConversationPreview['kind'], scope: string): Promise<LegacyConversationPreview[]> {
    const output: LegacyConversationPreview[] = [];
    for (const session of sessions) {
      const transcript = await store.importTranscript(scope, session.id, MAX_LEGACY_MESSAGES, MAX_MESSAGE_LENGTH);
      const messages: ContextLegacyImport['messages'][number][] = transcript.messages.map((message) => ({
        id: `legacy-chat-${session.id}-${message.id}`, role: 'user', text: message.text,
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
      }));
      if (!messages.length && !transcript.omittedCount) continue;
      output.push({ id: `${kind}-${session.id}`, title: transcript.session.title || (kind === 'chat' ? 'Saved chat' : 'Saved investigation'),
        kind, createdAt: validTimestamp(transcript.session.createdAt) ? transcript.session.createdAt : '',
        messages, omittedCount: transcript.omittedCount,
        ...(transcript.omittedCount ? { warning: `${transcript.omittedCount} incomplete or oversized question(s) will not be imported.` } : {}) });
    }
    return output;
  }
}

function toContextValue(fact: Fact): ContextValue | undefined {
  if (fact.condition === undefined || fact.condition === '==') {
    if (!('value' in fact) || !fact.value) return undefined;
    return { schemaVersion: 1, kind: 'scalar', scalar: fact.value };
  }
  if (fact.condition === 'in' && Array.isArray(fact.values) && fact.values.length) {
    return { schemaVersion: 1, kind: 'set', values: fact.values };
  }
  return undefined;
}
function summarizeFact(fact: Fact): string {
  if (fact.condition === 'in') return `${fact.values?.length ?? 0} typed values`;
  return fact.value ? `${fact.value.type} value` : 'Typed value';
}
function validTimestamp(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
