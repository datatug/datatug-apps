import { isJoinedDTQLQuery, parseDTQL, type DTQLSchema } from '@dalgo/core';
import { chatSQLite } from './chat-query-format';
import { ChatJoinAmbiguityError, ChatForeignKeyManifest, CHINOOK_FK_MANIFEST, ambiguousChatJoinRequest, deriveChatJoin, discoverChatJoinCandidates, validateChatJoinChoice } from './chat-joins';
import { CHINOOK_SCHEMA } from './chat.types';

const schema: DTQLSchema = { tables: [
  { schema: 'main', name: 'A', fields: ['Id', 'ParentId', 'PrimaryBId', 'SecondaryBId'] },
  { schema: 'main', name: 'B', fields: ['Id', 'Name'] },
  { schema: 'main', name: 'C', fields: ['AId', 'AParentId', 'Label'] },
] };
const manifest: ChatForeignKeyManifest = {
  version: 'test-v1', source: { repository: 'fixture', revision: '1', sha256: 'test' }, foreignKeys: [
    { id: 'A-primary-B', source: { schema: 'main', table: 'A', fields: ['PrimaryBId'] }, target: { schema: 'main', table: 'B', fields: ['Id'] } },
    { id: 'A-secondary-B', source: { schema: 'main', table: 'A', fields: ['SecondaryBId'] }, target: { schema: 'main', table: 'B', fields: ['Id'] } },
    { id: 'A-parent-A', source: { schema: 'main', table: 'A', fields: ['ParentId'] }, target: { schema: 'main', table: 'A', fields: ['Id'] } },
    { id: 'C-composite-A', source: { schema: 'main', table: 'C', fields: ['AId', 'AParentId'] }, target: { schema: 'main', table: 'A', fields: ['Id', 'ParentId'] } },
  ],
};

describe('Chat FK JOIN discovery', () => {
  it('keeps separate candidate identities for two FKs to one table, self links, and composite links', () => {
    const query = parseDTQL({ from: { schema: 'main', name: 'A' }, limit: 20 }, schema);
    const candidates = discoverChatJoinCandidates(query, manifest);
    expect(candidates.filter((item) => item.targetTable === 'B')).toHaveLength(2);
    expect(new Set(candidates.map((item) => item.id)).size).toBe(candidates.length);
    expect(candidates.find((item) => item.foreignKeyId === 'C-composite-A')?.sourceFields).toEqual(['Id', 'ParentId']);
    expect(candidates.filter((item) => item.targetTable === 'A').length).toBeGreaterThan(0);
  });

  it('derives validated DTQL for the selected edge, retains existing output IDs and exposes nested candidates', () => {
    const original = parseDTQL({ from: { schema: 'main', name: 'A' }, limit: 20 }, schema);
    const first = discoverChatJoinCandidates(original, manifest).find((item) => item.foreignKeyId === 'A-primary-B' && item.direction === 'forward');
    expect(first).toBeDefined();
    const joined = deriveChatJoin(original, first?.id || '', schema, manifest);
    expect(joined.query.from.joins[0].on).toEqual([{
      left: { source: 'A', field: 'PrimaryBId' }, operator: '==', right: { source: 'B', field: 'Id' },
    }]);
    expect(joined.query.columns?.map((column) => column.as)).toContain('Id');
    expect(joined.query.columns?.map((column) => column.as)).toContain('B.Name');
    expect(isJoinedDTQLQuery(parseDTQL(joined.dtql, schema))).toBe(true);
    const next = discoverChatJoinCandidates(joined.query, manifest);
    expect(next.find((item) => item.id === first?.id)).toBeUndefined();
    expect(next.find((item) => item.foreignKeyId === 'A-secondary-B' && item.sourcePath.length === 0)).toBeDefined();
    expect(next.find((item) => item.sourceAlias === 'B' && item.targetTable === 'A')).toBeDefined();
    const second = next.find((item) => item.foreignKeyId === 'A-secondary-B' && item.sourcePath.length === 0);
    const repeated = deriveChatJoin(joined.query, second?.id || '', schema, manifest);
    expect(repeated.lineage.targetAlias).toBe('B_2');
    expect(repeated.query.columns?.map((column) => column.as)).toContain('B_2.Name');
    expect(joined.query.columns?.map((column) => column.as)).not.toContain('B_2.Name');
  });

  it('appends to an exact nested relation instance and rejects stale edge IDs', () => {
    const base = parseDTQL({ from: { schema: 'main', name: 'C' }, limit: 5 }, schema);
    const composite = discoverChatJoinCandidates(base, manifest)[0];
    expect(composite.sourceFields).toEqual(['AId', 'AParentId']);
    const joined = deriveChatJoin(base, composite.id, schema, manifest);
    const nested = discoverChatJoinCandidates(joined.query, manifest).find((item) => item.sourcePath.join('.') === '0' && item.foreignKeyId === 'A-primary-B');
    expect(nested).toBeDefined();
    const chained = deriveChatJoin(joined.query, nested?.id || '', schema, manifest);
    expect(chained.query.from.joins[0].from.joins[0].from.name).toBe('B');
    expect(chained.query.from.joins).toHaveLength(1);
    expect(() => deriveChatJoin(base, composite.id, schema, { ...manifest, version: 'test-v2' })).toThrow(/no longer available/);
    expect(() => validateChatJoinChoice('Join A', 'rs', 'rs', composite.id,
      discoverChatJoinCandidates(base, { ...manifest, version: 'test-v2' }))).toThrow(/foreign-key metadata is no longer available/);
  });

  it('keeps repeated relation aliases distinct and refuses an ambiguous agent target', () => {
    const base = parseDTQL({ from: { schema: 'main', name: 'A' }, limit: 10 }, schema);
    const first = discoverChatJoinCandidates(base, manifest).find((item) => item.foreignKeyId === 'A-primary-B');
    const joined = deriveChatJoin(base, first?.id || '', schema, manifest);
    const second = discoverChatJoinCandidates(joined.query, manifest).find((item) => item.foreignKeyId === 'A-secondary-B' && !item.sourcePath.length);
    const repeated = deriveChatJoin(joined.query, second?.id || '', schema, manifest);
    const candidates = discoverChatJoinCandidates(repeated.query, manifest);
    expect(candidates.some((item) => item.sourceAlias === 'B' && item.sourcePath.join('.') === '0')).toBe(true);
    expect(candidates.some((item) => item.sourceAlias === 'B_2' && item.sourcePath.join('.') === '1')).toBe(true);
    const ambiguous = discoverChatJoinCandidates(base, manifest).filter((item) => item.targetTable === 'B');
    const error = ambiguousChatJoinRequest('Join B', 'rs', ambiguous);
    expect(error).toBeInstanceOf(ChatJoinAmbiguityError);
    expect(error?.choices).toHaveLength(2);
    expect(error?.choices.map((choice) => choice.candidateId)).toEqual(ambiguous.map((candidate) => candidate.id));
    expect(() => validateChatJoinChoice('Join B', 'rs', 'rs', ambiguous[0].id, ambiguous)).toThrow(/Several foreign-key relationships/);
    expect(ambiguousChatJoinRequest('Join B using PrimaryBId', 'rs', ambiguous)).toBeUndefined();
    expect(validateChatJoinChoice('Join B using PrimaryBId', 'rs', 'rs', ambiguous[0].id, ambiguous).id).toBe(ambiguous[0].id);
    expect(() => validateChatJoinChoice('Join B using PrimaryBId', 'old', 'rs', ambiguous[0].id, ambiguous)).toThrow(/latest result/);
  });

  it('expands a source-agnostic wildcard into stable, distinct output column IDs', () => {
    const base = parseDTQL({ from: { schema: 'main', name: 'A' }, limit: 10 }, schema);
    const first = discoverChatJoinCandidates(base, manifest).find((item) => item.foreignKeyId === 'A-primary-B');
    const joined = deriveChatJoin(base, first?.id || '', schema, manifest);
    const wildcard = parseDTQL({
      from: JSON.parse(joined.dtql).from, columns: [{ wildcard: { exclude: ['Name'] } }], limit: 10,
    }, schema);
    const second = discoverChatJoinCandidates(wildcard, manifest).find((item) => item.foreignKeyId === 'A-secondary-B' && !item.sourcePath.length);
    const expanded = deriveChatJoin(wildcard, second?.id || '', schema, manifest);
    expect(expanded.query.columns?.map((column) => column.as)).toContain('Id');
    expect(expanded.query.columns?.map((column) => column.as)).toContain('B.Id');
    expect(expanded.query.columns?.map((column) => column.as)).toContain('B_2.Name');
    expect(new Set(expanded.query.columns?.map((column) => column.as)).size).toBe(expanded.query.columns?.length);
  });

  it('uses the pinned Chinook FK to make a real Invoice to Customer query and SQLite preview', () => {
    expect(CHINOOK_FK_MANIFEST.foreignKeys).toHaveLength(11);
    const invoice = parseDTQL({ from: { schema: 'main', name: 'Invoice' }, limit: 10 }, CHINOOK_SCHEMA);
    const edge = discoverChatJoinCandidates(invoice).find((item) => item.targetTable === 'Customer' && item.direction === 'forward');
    const joined = deriveChatJoin(invoice, edge?.id || '', CHINOOK_SCHEMA);
    expect(joined.dtqlYaml).toContain('joins:');
    expect(chatSQLite(joined.query)).toContain('"Invoice"."CustomerId" = "Customer"."CustomerId"');
  });
});
