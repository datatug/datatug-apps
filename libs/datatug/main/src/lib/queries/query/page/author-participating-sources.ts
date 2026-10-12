import { parseTugQL } from '@dalgo/core';
import type { IQueryRelationshipBinding } from '../../../models/definition/query-def';

export interface AuthorParticipatingSource {
  readonly id: string;
  readonly kind: 'main' | 'join' | 'cte' | 'import' | 'subquery';
  readonly name: string;
  readonly schema?: string;
  readonly database?: string;
  readonly alias?: string;
  readonly scope?: string;
  readonly description: string;
  readonly removable: boolean;
  readonly removalReason?: string;
}

export interface AuthorSourceInventory {
  readonly available: boolean;
  readonly reason?: string;
  readonly sources: readonly AuthorParticipatingSource[];
  readonly customerJoined: boolean;
}

export type AuthorCustomerJoinRemoval =
  | {
      readonly ok: true;
      readonly before: string;
      readonly after: string;
      readonly removedOutputs: readonly string[];
      readonly relationship: IQueryRelationshipBinding;
    }
  | { readonly ok: false; readonly reason: string };

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const safeKeys = (value: unknown, allowed: readonly string[]): boolean => {
  const item = object(value);
  return !!item && Object.keys(item).every((key) => allowed.includes(key));
};

const sourceName = (value: unknown): string | undefined => {
  const item = object(value);
  return typeof item?.['name'] === 'string' ? item['name'] : undefined;
};

const sourceAlias = (value: unknown): string | undefined => {
  const item = object(value);
  return typeof item?.['alias'] === 'string' ? item['alias'] : undefined;
};

const sourceSchema = (value: unknown): string | undefined => {
  const item = object(value);
  return typeof item?.['schema'] === 'string' ? item['schema'] : undefined;
};

const sourceDatabase = (value: unknown): string | undefined => {
  const item = object(value);
  return typeof item?.['database'] === 'string' ? item['database'] : undefined;
};

const isMainDatabaseSource = (value: unknown): boolean => {
  const schema = sourceSchema(value);
  return (schema === undefined || schema === 'main') &&
    sourceDatabase(value) === undefined;
};

function addSource(
  sources: AuthorParticipatingSource[],
  input: Omit<AuthorParticipatingSource, 'id'>,
  path: string,
): void {
  sources.push(Object.freeze({
    ...input,
    id: `${path}:${input.kind}:${input.name}:${input.alias ?? ''}:${sources.length}`,
  }));
}

function visitQuery(
  query: unknown,
  path: string,
  sources: AuthorParticipatingSource[],
  includeMain = true,
  scope = 'Main query',
): boolean {
  const queryObject = object(query);
  const from = object(queryObject?.['from']);
  const name = sourceName(from);
  if (!from || !name) return false;
  let customerJoined = false;
  if (includeMain) {
    addSource(sources, {
      kind: 'main',
      name,
      schema: sourceSchema(from),
      database: sourceDatabase(from),
      alias: sourceAlias(from),
      scope,
      description: 'Main FROM source · this occurrence cannot be removed from the query.',
      removable: false,
      removalReason: 'The main FROM source anchors this query.',
    }, path);
  }
  const joins = from['joins'];
  if (Array.isArray(joins)) {
    joins.forEach((joinValue, index) => {
      const join = object(joinValue);
      const joined = object(join?.['from']);
      const joinedName = sourceName(joined);
      if (!join || !joinedName) return;
      const conditions = Array.isArray(join['on']) ? join['on'] as unknown[] : [];
      const condition = object(conditions[0]);
      const left = object(condition?.['left']);
      const right = object(condition?.['right']);
      const mainAlias = sourceAlias(from) ?? name;
      const joinedAlias = sourceAlias(joined) ?? joinedName;
      const eligibleCustomerJoin = name.toLowerCase() === 'invoice' &&
        isMainDatabaseSource(from) && isMainDatabaseSource(joined) &&
        joinedName.toLowerCase() === 'customer' &&
        joinedAlias.toLowerCase() !== mainAlias.toLowerCase() &&
        (join['type'] === undefined || join['type'] === 'inner') &&
        conditions.length === 1 && condition?.['op'] === '==' &&
        left?.['source'] === mainAlias && left['field'] === 'CustomerId' &&
        right?.['source'] === joinedAlias && right?.['field'] === 'CustomerId';
      const renderField = (field: Record<string, unknown> | undefined) =>
        field && typeof field['field'] === 'string'
          ? `${typeof field['source'] === 'string' ? `${field['source']}.` : ''}${field['field']}`
          : undefined;
      const predicateLeft = renderField(left);
      const predicateRight = renderField(right);
      const predicate = conditions.length === 1 && condition?.['op'] === '==' &&
          predicateLeft && predicateRight
        ? `${predicateLeft} = ${predicateRight}`
        : undefined;
      const alias = sourceAlias(joined);
      customerJoined = eligibleCustomerJoin || customerJoined;
      addSource(sources, {
        kind: 'join',
        name: joinedName,
        schema: sourceSchema(joined),
        database: sourceDatabase(joined),
        alias,
        scope,
        description: [typeof join['type'] === 'string' ? join['type'] : 'JOIN',
          predicate ?? 'Predicate details unavailable for this structure.']
          .filter(Boolean).join(' · '),
        removable: eligibleCustomerJoin,
        ...(eligibleCustomerJoin
          ? {}
          : { removalReason: 'This source occurrence is outside the admitted Invoice–Customer edit.' }),
      }, `${path}:join${index}`);
    });
  }
  const columns = queryObject?.['columns'];
  if (Array.isArray(columns)) {
    columns.forEach((column, index) => {
      const item = object(column);
      const nested = object(item?.['query']);
      if (!nested) return;
      const body = object(nested['query']);
      const scalarFrom = object(body?.['from']);
      const scalarName = sourceName(scalarFrom);
      if (scalarName) {
        const scalarOutput = typeof item?.['as'] === 'string' ? item['as'] : undefined;
        addSource(sources, {
          kind: 'subquery',
          name: scalarOutput ?? scalarName,
          schema: sourceSchema(scalarFrom),
          database: sourceDatabase(scalarFrom),
          scope: `Within scalar ${scalarOutput ?? scalarName}`,
          description: `Scalar query output · FROM ${scalarName}${sourceAlias(scalarFrom) ? ` as ${sourceAlias(scalarFrom)}` : ''} · removal is not supported for this query structure.`,
          removable: false,
          removalReason: 'Scalar subquery source ranges and dependencies are not available.',
        }, `${path}:column${index}`);
        // The subquery row represents its own FROM occurrence. Still walk its
        // JOINs and nested scalar queries so the inventory never hides them.
        const nestedCustomerJoined = visitBody(
          nested,
          `${path}:column${index}:query`,
          sources,
          false,
          `Within scalar ${scalarOutput ?? scalarName}`,
        );
        customerJoined = nestedCustomerJoined || customerJoined;
      }
    });
  }
  return customerJoined;
}

function visitBody(
  bodyValue: unknown,
  path: string,
  sources: AuthorParticipatingSource[],
  includeQueryMain = true,
  scope = 'Main query',
): boolean {
  const body = object(bodyValue);
  if (!body) return false;
  let customerJoined = visitQuery(body['query'], path, sources, includeQueryMain, scope);
  const definitions = Array.isArray(body['definitions']) ? body['definitions'] as unknown[] : [];
  definitions.forEach((definitionValue, index) => {
    const definition = object(definitionValue);
    if (!definition) return;
    const name = typeof definition['name'] === 'string' ? definition['name'] : 'unnamed';
    if (definition['kind'] === 'import') {
      addSource(sources, {
        kind: 'import',
        name,
        scope,
        description: `USING source · ${typeof definition['path'] === 'string' ? definition['path'] : 'path unavailable'} · removal is not supported for this query structure.`,
        removable: false,
        removalReason: 'USING source ranges and dependencies are not available.',
      }, `${path}:definition${index}`);
    } else if (definition['kind'] === 'cte') {
      addSource(sources, {
        kind: 'cte',
        name,
        scope,
        description: 'WITH definition · removal is not supported for this query structure.',
        removable: false,
        removalReason: 'WITH source ranges and dependencies are not available.',
      }, `${path}:definition${index}`);
      // A CTE definition and all nested source occurrences are distinct rows.
      const nestedCustomerJoined = visitBody(
        definition['query'],
        `${path}:definition${index}:${name}`,
        sources,
        true,
        `Within WITH ${name}`,
      );
      customerJoined = nestedCustomerJoined || customerJoined;
    }
  });
  return customerJoined;
}

/** Describes only sources represented by the current parsed draft, never Preview SQL text. */
export function inspectAuthorParticipatingSources(source: string): AuthorSourceInventory {
  const parsed = parseTugQL(source);
  if (parsed.diagnostics.length || !parsed.document.tree) {
    return Object.freeze({
      available: false,
      reason: 'This draft has TugQL diagnostics. Source occurrences remain visible in Code until it parses.',
      sources: Object.freeze([]),
      customerJoined: false,
    });
  }
  const sources: AuthorParticipatingSource[] = [];
  const customerJoined = visitBody(
    parsed.document.tree,
    'query',
    sources,
  );
  return Object.freeze({
    available: true,
    sources: Object.freeze(sources),
    customerJoined,
  });
}

const bindingMatches = (binding: IQueryRelationshipBinding): boolean =>
  binding.id === 'FK_Invoice_Customer_CustomerId' &&
  binding.from.schema === 'main' && binding.from.table === 'Invoice' &&
  binding.to.schema === 'main' && binding.to.table === 'Customer' &&
  binding.pairs.length === 1 && binding.pairs[0]?.fromField === 'CustomerId' &&
  binding.pairs[0]?.toField === 'CustomerId';

/** Removes only the admitted direct Customer JOIN and its trailing Customer projections. */
export function removeAuthorCustomerJoin(
  source: string,
  relationship: IQueryRelationshipBinding,
): AuthorCustomerJoinRemoval {
  try {
    if (!bindingMatches(relationship)) throw new Error('The admitted Invoice-to-Customer relationship pin is invalid.');
    const parsed = parseTugQL(source);
    const tree = parsed.document.tree as unknown as Record<string, unknown> | undefined;
    if (parsed.diagnostics.length || !tree) throw new Error('This draft has TugQL diagnostics and cannot be edited safely.');
    if (Array.isArray(tree['definitions']) && tree['definitions'].length) {
      throw new Error('WITH and USING sources are not removable by this admitted source edit.');
    }
    const query = object(tree['query']);
    const from = object(query?.['from']);
    const joins = from?.['joins'];
    const join = Array.isArray(joins) && joins.length === 1 ? object(joins[0]) : undefined;
    const joinedFrom = object(join?.['from']);
    const alias = sourceAlias(joinedFrom);
    const mainAlias = sourceAlias(from) ?? 'Invoice';
    if (!query || !from || sourceName(from) !== 'Invoice' ||
        (from['schema'] !== undefined && from['schema'] !== 'main') ||
        !join || sourceName(joinedFrom) !== 'Customer' || !alias ||
        (join['type'] !== undefined && join['type'] !== 'inner') ||
        (from['schema'] !== undefined && from['schema'] !== 'main') || from['database'] !== undefined ||
        (joinedFrom?.['schema'] !== undefined && joinedFrom['schema'] !== 'main') || joinedFrom?.['database'] !== undefined ||
        !safeKeys(from, ['name', 'schema', 'database', 'alias', 'joins']) ||
        !safeKeys(join, ['type', 'from', 'on'])) {
      throw new Error('Only one admitted Invoice-to-Customer JOIN can be removed here.');
    }
    const on = Array.isArray(join['on']) ? join['on'] as unknown[] : [];
    const predicate = object(on[0]);
    const left = object(predicate?.['left']);
    const right = object(predicate?.['right']);
    if (on.length !== 1 || predicate?.['op'] !== '==' ||
        left?.['source'] !== mainAlias || left['field'] !== 'CustomerId' ||
        right?.['source'] !== alias || right['field'] !== 'CustomerId') {
      throw new Error('The current Customer JOIN does not match the admitted Invoice.CustomerId relationship.');
    }
    if (!safeKeys(query, ['from', 'where', 'limit', 'orderBy', 'columns'])) {
      throw new Error('Filters, grouping, or other query clauses depend on source structure this edit cannot safely remove.');
    }
    const invoiceFields = new Set(['InvoiceId', 'InvoiceDate']);
    const orderBy = query['orderBy'];
    if (orderBy !== undefined && (!Array.isArray(orderBy) || orderBy.some((value) => {
      const item = object(value);
      return !item || !safeKeys(item, ['field', 'source', 'desc']) ||
        typeof item['field'] !== 'string' || !invoiceFields.has(item['field']) ||
        item['source'] !== mainAlias;
    }))) {
      throw new Error('Only the admitted Invoice output fields can remain in ORDER BY after this source edit.');
    }
    const columns = query['columns'];
    if (!Array.isArray(columns) || !columns.length) throw new Error('The projection is unavailable for this edit.');
    const customerFields: string[] = [];
    for (const column of columns) {
      const item = object(column);
      if (item?.['source'] === alias) {
        if (!['FirstName', 'LastName', 'Email'].includes(String(item['field'])) ||
            !safeKeys(item, ['field', 'source', 'as'])) {
          throw new Error('A Customer projection is not a supported direct output and cannot be removed safely.');
        }
        customerFields.push(String(item['field']));
      } else if (!item || item['query'] !== undefined || !safeKeys(item, ['field', 'source', 'as']) ||
          item['source'] !== mainAlias || typeof item['field'] !== 'string' || !invoiceFields.has(item['field'])) {
        throw new Error('A projection is not proven to belong to Invoice; source structure cannot be removed safely.');
      }
    }
    const where = object(query['where']);
    if (!where || where['op'] !== '==' ||
        object(where['left'])?.['field'] !== 'CustomerId' ||
        object(where['left'])?.['source'] !== mainAlias ||
        object(where['right'])?.['param'] !== 'CustomerId') {
      throw new Error('Only the admitted Invoice.CustomerId filter may remain when removing Customer.');
    }

    const lines = source.match(/[^\n]*(?:\n|$)/gu)?.filter((line) => line.length > 0) ?? [];
    const joinIndex = lines.findIndex((line) => new RegExp(`^\\s*join\\s+Customer\\s+as\\s+${alias}\\s*$`, 'iu').test(line.trimEnd()));
    if (joinIndex < 0 || joinIndex + 1 >= lines.length ||
        !new RegExp(`^\\s*on\\s+${mainAlias}\\.CustomerId\\s*=\\s*${alias}\\.CustomerId\\s*$`, 'iu').test((lines[joinIndex + 1] ?? '').trim())) {
      throw new Error('The exact JOIN and ON lines are not available for a source-preserving removal.');
    }
    const selectIndex = lines.findIndex((line) => /^\s*select\b/iu.test(line));
    if (selectIndex < 0) throw new Error('The SELECT source range is unavailable.');
    const removedOutputs: string[] = [];
    const selectLine = lines[selectIndex] ?? '';
    const blockSelect = /^\s*select\s*\(\s*$/iu.test(selectLine.trimEnd());
    if (blockSelect) {
      let closeIndex = -1;
      for (let index = selectIndex + 1; index < lines.length; index++) {
        if (/^\s*\)\s*$/u.test((lines[index] ?? '').trim())) { closeIndex = index; break; }
      }
      if (closeIndex < 0) throw new Error('The SELECT block range is ambiguous.');
      let firstCustomerLine = -1;
      const customerLines: number[] = [];
      for (let index = selectIndex + 1; index < closeIndex; index++) {
        const line = lines[index] ?? '';
        const field = new RegExp(`^\\s*${alias}\\.(FirstName|LastName|Email)(?:\\s+as\\s+([A-Za-z_]\\w*))?\\s*$`, 'iu').exec(line.trim());
        if (field) {
          firstCustomerLine = firstCustomerLine < 0 ? index : firstCustomerLine;
          customerLines.push(index);
          removedOutputs.push(field[2] ?? field[1] ?? '');
        } else if (firstCustomerLine >= 0 && line.trim() && !/^\s*--/u.test(line)) {
          throw new Error('Customer fields are not a trailing projection block; source order cannot be preserved safely.');
        }
      }
      for (const lineIndex of customerLines.reverse()) lines.splice(lineIndex, 1);
    } else {
      const eol = selectLine.endsWith('\r\n') ? '\r\n' : selectLine.endsWith('\n') ? '\n' : '';
      const content = eol ? selectLine.slice(0, -eol.length) : selectLine;
      if (content.includes('--')) throw new Error('Inline SELECT comments make the output range ambiguous.');
      const customerSuffix = new RegExp(`,\\s*${alias}\\.(FirstName|LastName|Email)(?:\\s+as\\s+([A-Za-z_]\\w*))?(?:\\s*,\\s*${alias}\\.(?:FirstName|LastName|Email)(?:\\s+as\\s+[A-Za-z_]\\w*)?)*\\s*$`, 'iu');
      const match = customerSuffix.exec(content);
      if (match) {
        const tail = match[0];
        const fields = tail.match(new RegExp(`${alias}\\.(?:FirstName|LastName|Email)(?:\\s+as\\s+[A-Za-z_]\\w*)?`, 'giu')) ?? [];
        for (const field of fields) {
          const aliasMatch = /^\w+\.(?:FirstName|LastName|Email)(?:\s+as\s+([A-Za-z_]\w*))?$/iu.exec(field);
          removedOutputs.push(aliasMatch?.[1] ?? field.replace(new RegExp(`^${alias}\\.`, 'iu'), '').split(/\s+/u)[0] ?? '');
        }
        lines[selectIndex] = `${content.slice(0, match.index)}${eol}`;
      } else if (customerFields.length) {
        throw new Error('Customer output fields are not a trailing source-preserving projection range.');
      }
    }
    if (removedOutputs.length !== customerFields.length) {
      throw new Error('The Customer output source ranges do not match the parsed projection.');
    }
    lines.splice(joinIndex, 2);
    const after = lines.join('');
    const candidate = parseTugQL(after);
    if (candidate.diagnostics.length || !candidate.document.tree)
      throw new Error('The proposed source removal does not parse as TugQL.');
    const beforeShape = JSON.parse(JSON.stringify(tree)) as Record<string, unknown>;
    const afterShape = JSON.parse(JSON.stringify(candidate.document.tree)) as Record<string, unknown>;
    const beforeQuery = object(beforeShape['query']) as Record<string, unknown>;
    const afterQuery = object(afterShape['query']) as Record<string, unknown>;
    const beforeFrom = object(beforeQuery['from']) as Record<string, unknown>;
    const afterFrom = object(afterQuery['from']) as Record<string, unknown>;
    delete beforeFrom['joins'];
    delete afterFrom['joins'];
    beforeQuery['columns'] = (beforeQuery['columns'] as unknown[]).filter((column) => object(column)?.['source'] !== alias);
    if (JSON.stringify(beforeShape) !== JSON.stringify(afterShape))
      throw new Error('The proposed removal changes semantics beyond the admitted JOIN and direct Customer outputs.');
    return Object.freeze({
      ok: true,
      before: source,
      after,
      removedOutputs: Object.freeze(removedOutputs),
      relationship,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error instanceof Error ? error.message : 'The current Customer source cannot be removed safely.',
    });
  }
}
