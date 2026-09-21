import {
  isJoinedDTQLQuery, parseDTQL, serializeJoinedDTQL, stringifyJoinedDTQL,
  type DTQLSchema, type JoinedDTQLQuery, type ParsedDTQLQuery, type QueryColumn,
  type QueryJoin, type QueryRelation,
} from '@dalgo/core';
import manifestData from './chinook-fks.json';
import { ChatJoinChoice, ChatJoinLineage } from './chat.types';

type Data = Record<string, unknown>;

export interface ChatForeignKey {
  readonly id: string;
  readonly source: { readonly schema: string; readonly table: string; readonly fields: readonly string[] };
  readonly target: { readonly schema: string; readonly table: string; readonly fields: readonly string[] };
}

export interface ChatForeignKeyManifest {
  readonly version: string;
  readonly source: { readonly repository: string; readonly revision: string; readonly sha256: string };
  readonly foreignKeys: readonly ChatForeignKey[];
}

export const CHINOOK_FK_MANIFEST: ChatForeignKeyManifest = manifestData;

export interface ChatJoinCandidate {
  readonly id: string;
  readonly manifestVersion: string;
  readonly foreignKeyId: string;
  readonly direction: 'forward' | 'reverse';
  readonly sourcePath: readonly number[];
  readonly sourceAlias: string;
  readonly sourceTable: string;
  readonly sourceFields: readonly string[];
  readonly targetSchema: string;
  readonly targetTable: string;
  readonly targetFields: readonly string[];
  readonly cardinality: 'many-to-one' | 'one-to-many';
}

export interface DerivedChatJoin {
  readonly query: JoinedDTQLQuery;
  readonly dtql: string;
  readonly dtqlYaml: string;
  readonly candidate: ChatJoinCandidate;
  readonly lineage: ChatJoinLineage;
}

function aliasOf(relation: QueryRelation): string {
  return relation.alias || relation.name;
}

function relationFromQuery(query: ParsedDTQLQuery<Data>): QueryRelation {
  if (isJoinedDTQLQuery(query)) return query.from;
  const index = query.source.name.lastIndexOf('.');
  return {
    name: index < 0 ? query.source.name : query.source.name.slice(index + 1),
    ...(index < 0 ? {} : { schema: query.source.name.slice(0, index) }),
    joins: [],
  };
}

function visitRelations(root: QueryRelation, visit: (relation: QueryRelation, path: readonly number[]) => void): void {
  const seen = new WeakSet<QueryRelation>();
  const walk = (relation: QueryRelation, path: readonly number[]): void => {
    if (seen.has(relation)) return;
    seen.add(relation);
    visit(relation, path);
    relation.joins.forEach((join, index) => walk(join.from, [...path, index]));
  };
  walk(root, []);
}

function tableMatches(relation: QueryRelation, schema: string, table: string): boolean {
  return (relation.schema || 'main') === schema && relation.name === table;
}

function activeEdge(root: QueryRelation, candidate: ChatJoinCandidate): boolean {
  let active = false;
  visitRelations(root, (relation) => {
    if (active) return;
    for (const join of relation.joins) {
      if (!tableMatches(join.from, candidate.targetSchema, candidate.targetTable) ||
          join.on.length !== candidate.sourceFields.length) continue;
      const targetAlias = aliasOf(join.from);
      const actual = join.on.map((predicate) => {
        const left = predicate.left;
        const right = predicate.right;
        if (left.source === candidate.sourceAlias && right.source === targetAlias) return `${left.field}\u0000${right.field}`;
        if (right.source === candidate.sourceAlias && left.source === targetAlias) return `${right.field}\u0000${left.field}`;
        return '';
      });
      const expected = candidate.sourceFields.map((field, index) => `${field}\u0000${candidate.targetFields[index]}`);
      if (actual.every((value, index) => value && value === expected[index])) {
        active = true;
        break;
      }
    }
  });
  return active;
}

export function discoverChatJoinCandidates(
  query: ParsedDTQLQuery<Data>, manifest: ChatForeignKeyManifest = CHINOOK_FK_MANIFEST,
): readonly ChatJoinCandidate[] {
  const root = relationFromQuery(query);
  const candidates: ChatJoinCandidate[] = [];
  visitRelations(root, (relation, sourcePath) => {
    const sourceAlias = aliasOf(relation);
    for (const fk of manifest.foreignKeys) {
      for (const direction of ['forward', 'reverse'] as const) {
        const source = direction === 'forward' ? fk.source : fk.target;
        const target = direction === 'forward' ? fk.target : fk.source;
        if (!tableMatches(relation, source.schema, source.table)) continue;
        const candidate: ChatJoinCandidate = {
          id: JSON.stringify([manifest.version, sourcePath, sourceAlias, fk.id, direction]),
          manifestVersion: manifest.version, foreignKeyId: fk.id, direction,
          sourcePath, sourceAlias, sourceTable: source.table, sourceFields: source.fields,
          targetSchema: target.schema, targetTable: target.table, targetFields: target.fields,
          cardinality: direction === 'forward' ? 'many-to-one' : 'one-to-many',
        };
        if (!activeEdge(root, candidate)) candidates.push(candidate);
      }
    }
  });
  return candidates;
}

export function chatJoinCandidateLabel(candidate: ChatJoinCandidate, group: readonly ChatJoinCandidate[]): string {
  const ambiguous = group.filter((other) => other.sourceAlias === candidate.sourceAlias &&
    other.targetTable === candidate.targetTable).length > 1;
  const fields = ambiguous || candidate.sourceFields.length > 1 || candidate.sourceTable === candidate.targetTable
    ? ` (${candidate.sourceFields.join(', ')})` : '';
  return `${candidate.targetTable}${fields} ${candidate.cardinality === 'many-to-one' ? '→1' : '→*'}`;
}

export class ChatJoinAmbiguityError extends Error {
  constructor(readonly choices: readonly ChatJoinChoice[]) {
    super('Several foreign-key relationships match. Choose the exact source and fields below.');
  }
}

function mentions(question: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])${escaped}(?=$|[^a-z0-9_])`, 'i').test(question);
}

function matchedEdges(question: string, peers: readonly ChatJoinCandidate[]): readonly ChatJoinCandidate[] {
  const byAlias = peers.filter((item) => mentions(question, item.sourceAlias));
  const byField = peers.filter((item) => item.sourceFields.some((field) => mentions(question, field)));
  return byAlias.length && byField.length ? byAlias.filter((item) => byField.includes(item)) :
    byField.length ? byField : byAlias;
}

function ambiguity(recordSetId: string, peers: readonly ChatJoinCandidate[]): ChatJoinAmbiguityError {
  return new ChatJoinAmbiguityError(peers.map((item) => ({
    recordSetId, candidateId: item.id,
    label: `${item.sourceAlias}.${item.sourceFields.join('+')} → ${item.targetTable}`,
  })));
}

/** Handle obvious ambiguous natural-language targets before spending a provider request. */
export function ambiguousChatJoinRequest(
  question: string, recordSetId: string, candidates: readonly ChatJoinCandidate[],
): ChatJoinAmbiguityError | undefined {
  if (!mentions(question, 'join')) return undefined;
  const targets = [...new Set(candidates.map((item) => item.targetTable))]
    .filter((table) => mentions(question, table) || mentions(question, `${table}s`));
  if (targets.length !== 1) return undefined;
  const peers = candidates.filter((item) => item.targetTable === targets[0]);
  if (peers.length < 2 || matchedEdges(question, peers).length === 1) return undefined;
  return ambiguity(recordSetId, peers);
}

/** Reject a model's guess when the user's target still names multiple FK edges. */
export function validateChatJoinChoice(
  question: string, recordSetId: string, latestRecordSetId: string, candidateId: string,
  candidates: readonly ChatJoinCandidate[],
): ChatJoinCandidate {
  if (recordSetId !== latestRecordSetId && !question.includes(recordSetId)) {
    throw new Error('The JOIN must use the latest result, or name an exact saved RecordSet ID.');
  }
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate) {
    try {
      const identity = JSON.parse(candidateId) as unknown;
      if (Array.isArray(identity) && typeof identity[0] === 'string' &&
          candidates.some((item) => item.manifestVersion !== identity[0])) {
        throw new Error('Cannot JOIN: foreign-key metadata is no longer available. Refresh this result.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Cannot JOIN:')) throw error;
    }
    throw new Error('The requested relationship is unavailable. Choose a current foreign-key candidate.');
  }
  const peers = candidates.filter((item) => item.targetTable === candidate.targetTable);
  if (peers.length < 2) return candidate;
  const exact = matchedEdges(question, peers);
  if (exact.length !== 1 || exact[0].id !== candidate.id) {
    throw ambiguity(recordSetId, peers);
  }
  return candidate;
}

function joinedBase(query: ParsedDTQLQuery<Data>): JoinedDTQLQuery {
  if (isJoinedDTQLQuery(query)) return query;
  if (query.filters.length > 1) throw new Error('This result has unsupported filter groups for an interactive JOIN.');
  const source = aliasOf(relationFromQuery(query));
  return {
    kind: 'joined-dtql', from: relationFromQuery(query),
    filters: query.filters.map((filter) => ({ ...filter, field: { source, field: filter.field } })),
    orders: query.orders.map((order) => ({ ...order, field: { source, field: order.field } })),
    limit: query.limit, offset: query.offset,
  };
}

function aliasesIn(root: QueryRelation): Set<string> {
  const aliases = new Set<string>();
  visitRelations(root, (relation) => aliases.add(aliasOf(relation)));
  return aliases;
}

function outputName(column: QueryColumn): string {
  return column.as || (column.expression?.kind === 'field' ? column.expression.field.field : '');
}

function explicitColumns(query: JoinedDTQLQuery, schema: DTQLSchema): QueryColumn[] {
  const columns: QueryColumn[] = [];
  if (query.columns) {
    for (const column of query.columns) {
      if (!column.wildcard) {
        columns.push(column);
        continue;
      }
      const source = column.wildcard.source;
      if (!source) {
        const used = new Set(columns.map(outputName));
        visitRelations(query.from, (relation, path) => {
          const table = schema.tables.find((item) => item.name === relation.name && item.schema === (relation.schema || 'main'));
          if (!table) throw new Error(`Cannot expand a wildcard for ${relation.name}.`);
          const alias = aliasOf(relation);
          for (const field of table.fields) {
            if (column.wildcard?.exclude.includes(field)) continue;
            const preferred = path.length ? `${alias}.${field}` : field;
            let name = preferred;
            for (let suffix = 2; used.has(name); suffix++) name = `${preferred}_${suffix}`;
            used.add(name);
            columns.push({ expression: { kind: 'field', field: { source: alias, field } }, as: name });
          }
        });
        continue;
      }
      let relation: QueryRelation | undefined;
      visitRelations(query.from, (item) => {
        if (aliasOf(item) === source) relation = item;
      });
      const table = schema.tables.find((item) => item.name === relation?.name && item.schema === (relation?.schema || 'main'));
      if (!table) throw new Error('Cannot expand the current DTQL wildcard for this JOIN.');
      for (const field of table.fields) {
        if (!column.wildcard.exclude.includes(field)) {
          columns.push({ expression: { kind: 'field', field: { source, field } }, as: field });
        }
      }
    }
    return columns;
  }
  if (query.groupBy?.length || query.having) {
    throw new Error('Select explicit columns before joining a grouped result.');
  }
  visitRelations(query.from, (relation, path) => {
    const table = schema.tables.find((item) => item.name === relation.name && item.schema === (relation.schema || 'main'));
    if (!table) throw new Error(`Cannot project unknown relation ${relation.name}.`);
    const alias = aliasOf(relation);
    for (const field of table.fields) {
      columns.push({ expression: { kind: 'field', field: { source: alias, field } }, as: path.length ? `${alias}.${field}` : field });
    }
  });
  return columns;
}

function appendJoin(root: QueryRelation, path: readonly number[], join: QueryJoin): QueryRelation {
  if (!path.length) return { ...root, joins: [...root.joins, join] };
  const [index, ...rest] = path;
  if (index === undefined || !root.joins[index]) throw new Error('The source relation is no longer available.');
  return {
    ...root,
    joins: root.joins.map((item, position) => position === index
      ? { ...item, from: appendJoin(item.from, rest, join) } : item),
  };
}

export function deriveChatJoin(
  query: ParsedDTQLQuery<Data>, candidateId: string, schema: DTQLSchema,
  manifest: ChatForeignKeyManifest = CHINOOK_FK_MANIFEST,
): DerivedChatJoin {
  const candidate = discoverChatJoinCandidates(query, manifest).find((item) => item.id === candidateId);
  if (!candidate) throw new Error('Cannot JOIN: foreign-key metadata is no longer available. Refresh this result.');
  const base = joinedBase(query);
  const aliases = aliasesIn(base.from);
  let targetAlias = candidate.targetTable;
  for (let suffix = 2; aliases.has(targetAlias); suffix++) targetAlias = `${candidate.targetTable}_${suffix}`;
  const join: QueryJoin = {
    type: 'inner',
    from: { schema: candidate.targetSchema, name: candidate.targetTable, alias: targetAlias, joins: [] },
    on: candidate.sourceFields.map((field, index) => ({
      left: { source: candidate.sourceAlias, field }, operator: '==',
      right: { source: targetAlias, field: candidate.targetFields[index] },
    })),
  };
  const columns = explicitColumns(base, schema);
  const used = new Set(columns.map(outputName));
  const target = schema.tables.find((item) => item.name === candidate.targetTable && item.schema === candidate.targetSchema);
  if (!target) throw new Error(`Cannot JOIN ${candidate.targetTable}: its schema is unavailable.`);
  if (!base.groupBy?.length && !base.having) {
    for (const field of target.fields) {
      const preferred = `${targetAlias}.${field}`;
      let name = preferred;
      for (let suffix = 2; used.has(name); suffix++) name = `${preferred}_${suffix}`;
      used.add(name);
      columns.push({ expression: { kind: 'field', field: { source: targetAlias, field } }, as: name });
    }
  }
  const derived: JoinedDTQLQuery = { ...base, from: appendJoin(base.from, candidate.sourcePath, join), columns };
  const dtql = JSON.stringify(serializeJoinedDTQL(derived));
  const validated = parseDTQL(dtql, schema, { maxLimit: 1000 });
  if (!isJoinedDTQLQuery(validated)) throw new Error('The derived DTQL did not contain a JOIN.');
  const lineage: ChatJoinLineage = {
    candidateId: candidate.id, manifestVersion: candidate.manifestVersion,
    foreignKeyId: candidate.foreignKeyId, direction: candidate.direction,
    sourcePath: candidate.sourcePath, sourceAlias: candidate.sourceAlias, targetAlias,
    sourceTable: candidate.sourceTable, targetTable: candidate.targetTable,
    sourceFields: candidate.sourceFields, targetFields: candidate.targetFields,
  };
  return { query: validated, dtql, dtqlYaml: stringifyJoinedDTQL(validated), candidate, lineage };
}
