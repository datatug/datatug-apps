import type {
  RecursiveDTQLExpression,
  RecursiveDTQLQuery,
  TugQLResolved,
  TugQLDocument,
  TugQLTree,
} from '@dalgo/core';

export interface PublicSqlitePreparedPlan {
  readonly sql: string;
  readonly bindings: readonly (string | number | null)[];
  readonly bindingNames: readonly string[];
  readonly sourceId: 'chinook-sqlite';
  readonly fixtureSha256: string;
  readonly schemaVersion: string;
  readonly draftRevision: number;
  readonly relationship?: PublicSqliteRelationshipReceipt;
  readonly outputColumns?: readonly PublicSqliteOutputColumn[];
  readonly authorProof: PublicSqliteAuthorProof;
}

export interface PublicSqliteAuthorProof {
  readonly profile: 'invoice-query' | 'customer-count-cte' | 'bounded-cte-query';
  readonly resolvedQuery: RecursiveDTQLQuery;
  readonly authoredSource?: string;
  readonly relationship?: PublicSqliteRelationshipReceipt;
}

export interface PublicSqliteRelationshipReceipt {
  readonly id: string;
  readonly version: string;
  readonly fromSource: string;
  readonly toSource: string;
  readonly joinType: 'inner';
  readonly pairs: readonly {
    readonly fromField: string;
    readonly toField: string;
  }[];
}

export const PUBLIC_CHINOOK_CUSTOMER_FK = 'FK_Invoice_Customer_CustomerId';

export interface PublicSqliteOutputColumn {
  readonly name: string;
  readonly type: 'integer' | 'string';
  readonly lineage: readonly {
    readonly source: string;
    readonly field: string;
  }[];
}

/** UI-supplied origin metadata. It is explicitly client-reported, not worker proof. */
export interface PublicSqliteClientReportedBinding {
  readonly origin: 'manual' | 'selection';
  readonly originEvidence: 'client-reported';
  readonly sourceQueryId?: string;
  readonly sourceColumn?: string;
}

/** A structural preview has no user-provided values and is safe to show before Run. */
export type PublicSqliteQueryPreview = Omit<
  PublicSqlitePreparedPlan,
  'bindings' | 'relationship'
> & {
  readonly fixedBindings: readonly (string | number | null)[];
  /** Values and the required parameter are collected in emitted SQL order. */
  readonly bindingSlots?: readonly PublicSqliteBindingSlot[];
  readonly relationship?: PublicSqliteRelationshipReceipt;
  /** Source-preserving edit to make a resolver-completed ON clause reviewable before Run. */
  readonly expandedSource?: string;
};

export type PublicSqliteBindingSlot =
  | { readonly kind: 'customer-id'; readonly name: 'CustomerId' }
  | { readonly kind: 'literal'; readonly name: string; readonly value: number };

export type PublicSqliteExecutionReceipt = Omit<
  PublicSqlitePreparedPlan,
  'bindings' | 'authorProof'
> & {
  readonly executionId: string;
  readonly bindingNames: readonly string[];
  readonly relationship?: PublicSqliteRelationshipReceipt;
  readonly outputColumns?: readonly PublicSqliteOutputColumn[];
  /** UI-supplied origin metadata; the worker verifies values, not this claim. */
  readonly clientReportedBinding?: PublicSqliteClientReportedBinding;
};

const SQL_COMPARISON_OPERATORS: Readonly<Record<string, string>> = {
  '==': '=',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
};

const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

/** Reject unsafe or unreachable authored CTE syntax before Core can expand it. */
export function validatePublicSqliteCteSource(tree: TugQLTree): boolean {
  if (tree.definitions === undefined) return false;
  const allowedKeys = new Set([
    'format', 'version', 'parameters', 'definitions', 'kind', 'name', 'query',
    'from', 'where', 'schema', 'database', 'alias', 'joins', 'type', 'on', 'op', 'left',
    'right', 'field', 'source', 'param', 'value', 'aggregate', 'function', 'args',
    'star', 'distinct', 'groupBy', 'having', 'limit', 'offset', 'orderBy',
    'direction', 'columns', 'as', 'expression', 'wildcard', 'exclude', 'required',
    'default', 'using', 'path', 'conditions', 'kind', 'operand',
  ]);
  const definitions: { name: string; body: Readonly<Record<string, unknown>>; index: number }[] = [];
  const queries: { query: Readonly<Record<string, unknown>>; owner?: string; available: ReadonlySet<string> }[] = [];
  const scanKeys = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(scanKeys); return; }
    const object = value as Readonly<Record<string, unknown>>;
    for (const key of Object.keys(object)) {
      if (!allowedKeys.has(key)) throw new Error(`The bounded CTE source contains an unsupported key: ${key}.`);
    }
    if ('path' in object || 'using' in object || object['kind'] === 'import' || 'exists' in object || 'notExists' in object)
      throw new Error('Saved-query imports are not supported in the bounded CTE profile.');
    if (object['kind'] === 'import') throw new Error('Imports are not supported in the bounded CTE profile.');
    Object.values(object).forEach(scanKeys);
  };
  scanKeys(tree);
  const requireShape = (value: unknown, allowed: readonly string[], required: readonly string[], label: string): Readonly<Record<string, unknown>> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The bounded CTE source has an invalid ${label}.`);
    const object = value as Readonly<Record<string, unknown>>;
    if (Object.keys(object).some((key) => !allowed.includes(key)) || required.some((key) => !(key in object)))
      throw new Error(`The bounded CTE source has an unsupported ${label} shape.`);
    return object;
  };
  const validateField = (value: unknown, label: string): void => {
    const field = requireShape(value, ['field', 'source'], ['field'], label);
    if (typeof field['field'] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field['field']) || (field['source'] !== undefined && (typeof field['source'] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field['source']))))
      throw new Error(`The bounded CTE source uses an unsupported ${label}.`);
  };
  const validateExpression = (value: unknown, label: string): void => {
    const object = requireShape(value, ['field', 'source', 'param', 'value', 'aggregate', 'as'], [], label);
    const variants = ['field', 'param', 'value', 'aggregate'].filter((key) => key in object);
    if (variants.length !== 1) throw new Error(`The bounded CTE source has an unsupported ${label}.`);
    if ('field' in object) {
      const field = { ...object };
      delete (field as Record<string, unknown>)['as'];
      validateField(field, label);
    }
    if ('param' in object && (Object.keys(object).length !== 1 || typeof object['param'] !== 'string')) throw new Error(`The bounded CTE source has an invalid ${label} parameter.`);
    if ('value' in object && (Object.keys(object).length !== 1 || !('value' in object))) throw new Error(`The bounded CTE source has an invalid ${label} literal.`);
    if ('aggregate' in object) {
      const aggregate = requireShape(object['aggregate'], ['function', 'args', 'distinct'], ['function', 'args'], `${label} aggregate`);
      if (aggregate['function'] !== 'count' || aggregate['distinct'] === true || !Array.isArray(aggregate['args']) || aggregate['args'].length !== 1) throw new Error(`The bounded CTE source has unsupported ${label} aggregate arguments.`);
      for (const argument of aggregate['args'] as readonly unknown[]) {
        const item = requireShape(argument, ['star', 'field', 'source', 'param', 'value'], [], `${label} argument`);
        if ('star' in item) {
          if (Object.keys(item).length !== 1 || item['star'] !== true) throw new Error(`The bounded CTE source has an unsupported ${label} argument.`);
        } else validateExpression(item, `${label} argument`);
      }
    }
  };
  const validatePredicate = (value: unknown, label: string): void => {
    const predicate = requireShape(value, ['op', 'left', 'right'], ['op', 'left', 'right'], label);
    if (typeof predicate['op'] !== 'string' || !Object.hasOwn(SQL_COMPARISON_OPERATORS, predicate['op'])) throw new Error(`The bounded CTE source has an unsupported ${label} comparison.`);
    validateExpression(predicate['left'], `${label} left operand`);
    validateExpression(predicate['right'], `${label} right operand`);
  };
  const visitQuery = (query: Readonly<Record<string, unknown>>, owner: string | undefined, available: ReadonlySet<string>): void => {
    requireShape(query, ['from', 'where', 'orderBy', 'limit', 'offset', 'columns', 'groupBy', 'having'], ['from', 'limit', 'columns'], 'query');
    if (query['where'] !== undefined) validatePredicate(query['where'], 'WHERE');
    if (query['having'] !== undefined) validatePredicate(query['having'], 'HAVING');
    const where = query['where'] as Readonly<Record<string, unknown>> | undefined;
    if (where) {
      const right = where['right'] as Readonly<Record<string, unknown>> | undefined;
      if (right && !('param' in right) && (typeof right['value'] !== 'number' || !Number.isSafeInteger(right['value'])))
        throw new Error('WHERE supports only integer fields compared with safe integer literals.');
    }
    const having = query['having'] as Readonly<Record<string, unknown>> | undefined;
    if (having) {
      const right = having['right'] as Readonly<Record<string, unknown>> | undefined;
      if (typeof right?.['value'] !== 'number' || !Number.isSafeInteger(right['value']))
        throw new Error('HAVING supports only COUNT compared with a safe integer literal.');
    }
    if (query['groupBy'] !== undefined) {
      if (!Array.isArray(query['groupBy'])) throw new Error('GROUP BY fields must be a list.');
      (query['groupBy'] as readonly unknown[]).forEach((field) => validateField(field, 'GROUP BY field'));
    }
    if (query['orderBy'] !== undefined) {
      if (!Array.isArray(query['orderBy'])) throw new Error('ORDER BY fields must be a list.');
      for (const order of query['orderBy'] as readonly unknown[]) {
        const item = requireShape(order, ['field', 'source', 'direction'], ['field'], 'ORDER BY field');
        validateField({ field: item['field'], ...(item['source'] !== undefined ? { source: item['source'] } : {}) }, 'ORDER BY field');
        if (item['direction'] !== undefined && item['direction'] !== 'asc' && item['direction'] !== 'desc') throw new Error('ORDER BY direction is unsupported.');
      }
    }
    if (Array.isArray(query['columns'])) for (const column of query['columns'] as readonly unknown[]) {
      const item = requireShape(column, ['field', 'source', 'aggregate', 'as'], [], 'projection');
      if (['field', 'aggregate'].filter((key) => key in item).length !== 1) throw new Error('Wildcard and computed projections are not supported in the bounded CTE profile.');
      validateExpression(item, 'projection');
    }
    const limit = query['limit'];
    const columns = query['columns'];
    if (query['offset'] !== undefined || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100 || !Array.isArray(columns) || !columns.length || columns.length > 40)
      throw new Error('Every bounded CTE query requires LIMIT 1..100 and 1..40 explicit columns.');
    queries.push({ query, ...(owner ? { owner } : {}), available });
    const from = requireShape(query['from'], ['name', 'schema', 'database', 'alias', 'joins'], ['name'], 'query source');
    if (from['database'] !== undefined || typeof from['name'] !== 'string' || (from['alias'] !== undefined && typeof from['alias'] !== 'string'))
      throw new Error('Anonymous, database-qualified, or unsupported schema sources are not allowed.');
    const relations = [from, ...((Array.isArray(from['joins']) ? from['joins'] as readonly Readonly<Record<string, unknown>>[] : []).map((join) => (join as Readonly<Record<string, unknown>>)['from'] as Readonly<Record<string, unknown>>))];
    const aliases = relations.map((relation) => String(relation?.['alias'] ?? relation?.['name'] ?? '').toLowerCase());
    if (aliases.some((alias) => !alias))
      throw new Error('Query-scope aliases must be unique ignoring case.');
    if (new Set(aliases).size !== aliases.length) {
      const customerAliasCollision = relations.some((relation, index) => relations.some((other, otherIndex) =>
        index < otherIndex &&
        String(relation['alias'] ?? relation['name']).toLowerCase() === String(other['alias'] ?? other['name']).toLowerCase() &&
        ((String(relation['name']).toLowerCase() === 'customer' && definitions.some((definition) => definition.name.toLowerCase() === String(other['name']).toLowerCase())) ||
          (String(other['name']).toLowerCase() === 'customer' && definitions.some((definition) => definition.name.toLowerCase() === String(relation['name']).toLowerCase())))));
      if (customerAliasCollision) throw new Error('CTE and Customer aliases must be distinct ignoring case.');
      throw new Error('Query-scope aliases must be unique ignoring case.');
    }
    const outputNames = (columns as readonly Readonly<Record<string, unknown>>[]).map((column) => String(column['as'] ?? column['field'] ?? (column['aggregate'] ? 'count' : '')).toLowerCase());
    if (outputNames.some((name) => !name) || new Set(outputNames).size !== outputNames.length)
      throw new Error('Output names must be unique ignoring case in every bounded CTE query.');
    for (const relation of relations) {
      if (!relation || typeof relation['name'] !== 'string' || relation['database'] !== undefined)
        throw new Error('Anonymous, database-qualified, or unsupported schema sources are not allowed.');
    }
    if (Array.isArray(from['joins'])) for (const joinRaw of from['joins'] as readonly unknown[]) {
      const join = requireShape(joinRaw, ['from', 'on', 'type'], ['from', 'on'], 'JOIN');
      if (join['type'] !== undefined && join['type'] !== 'inner') throw new Error('Only explicit INNER joins are supported in the bounded CTE source.');
      const joined = requireShape(join['from'], ['name', 'schema', 'database', 'alias', 'joins'], ['name'], 'JOIN source');
      if (joined['database'] !== undefined || typeof joined['name'] !== 'string' || typeof joined['alias'] !== 'string') throw new Error('JOIN sources must be named, unqualified, and explicitly aliased.');
      if (joined['joins'] !== undefined) throw new Error('Nested joins on a joined relation are not supported.');
      if (!Array.isArray(join['on']) || !join['on'].length) throw new Error('JOIN requires an explicit equality predicate.');
      for (const on of join['on'] as readonly unknown[]) {
        const predicate = requireShape(on, ['op', 'left', 'right'], ['op', 'left', 'right'], 'JOIN predicate');
        if (predicate['op'] !== '==') throw new Error('JOIN requires an explicit equality predicate.');
        validateField(predicate['left'], 'JOIN left field');
        validateField(predicate['right'], 'JOIN right field');
      }
    }
  };
  const visitBody = (body: Readonly<Record<string, unknown>>, owner?: string, inherited: ReadonlySet<string> = new Set()): void => {
    requireShape(body, ['definitions', 'query'], ['query'], 'CTE body');
    const nested = body['definitions'];
    if (nested !== undefined && !Array.isArray(nested)) throw new Error('CTE definitions must be a list.');
    const available = new Set(inherited);
    for (const raw of (nested ?? []) as readonly unknown[]) {
      const definition = requireShape(raw, ['kind', 'name', 'query'], ['kind', 'name', 'query'], 'CTE definition');
      if (definition['kind'] !== 'cte' || typeof definition['name'] !== 'string')
        throw new Error('Only named, non-recursive CTE definitions are supported.');
      const name = definition['name'];
      if (definitions.some((candidate) => candidate.name.toLowerCase() === name.toLowerCase()) || ['invoice', 'customer'].includes(name.toLowerCase()))
        throw new Error('CTE names must be unique ignoring case and cannot shadow Invoice or Customer.');
      const childBody = definition['query'] as Readonly<Record<string, unknown>> | undefined;
      if (!childBody || typeof childBody['query'] !== 'object') throw new Error('A CTE must contain an explicit query body.');
      definitions.push({ name, body: childBody, index: definitions.length });
      visitBody(childBody, name, available);
      available.add(name.toLowerCase());
    }
    const query = body['query'] as Readonly<Record<string, unknown>> | undefined;
    if (!query) throw new Error('Every CTE body requires a query.');
    visitQuery(query, owner, available);
  };
  const document = requireShape(tree, ['format', 'version', 'parameters', 'definitions', 'query'], ['format', 'version', 'definitions', 'query'], 'TugQTree document');
  if (document['format'] !== 'tugqtree' || document['version'] !== 1 || !Array.isArray(document['definitions']))
    throw new Error('The bounded CTE source uses an unsupported TugQTree version.');
  if (document['parameters'] !== undefined) {
    if (!Array.isArray(document['parameters'])) throw new Error('Parameters must be a list.');
    for (const parameter of document['parameters'] as readonly unknown[])
      requireShape(parameter, ['name', 'type', 'required', 'default'], ['name', 'type'], 'parameter');
  }
  visitBody({ definitions: tree.definitions, query: tree.query });
  if (definitions.length < 1 || definitions.length > 3)
    throw new Error('The bounded CTE profile supports one to three authored definitions.');
  const root = queries.find((entry) => entry.owner === undefined)?.query;
  const rootOrder = root?.['orderBy'] as readonly Readonly<Record<string, unknown>>[] | undefined;
  if (!rootOrder || rootOrder.length !== 1 || (rootOrder[0]?.['direction'] !== undefined && rootOrder[0]?.['direction'] !== 'asc'))
    throw new Error('The root query requires one CustomerId-derived ascending order before LIMIT.');
  for (const { query } of queries) {
    const from = query['from'] as Readonly<Record<string, unknown>> | undefined;
    if (from?.['name'] !== 'Customer') continue;
    const customerOrder = query['orderBy'] as readonly Readonly<Record<string, unknown>>[] | undefined;
    const alias = String(from['alias'] ?? 'Customer');
    if (customerOrder?.length !== 1 || (customerOrder[0]?.['direction'] !== undefined && customerOrder[0]?.['direction'] !== 'asc') || customerOrder[0]?.['field'] !== 'CustomerId' || (customerOrder[0]?.['source'] !== undefined && customerOrder[0]['source'] !== alias))
      throw new Error('The physical Customer query must order by Customer.CustomerId before LIMIT.');
  }
  const references = new Map(definitions.map((definition) => [definition.name.toLowerCase(), 0]));
  const edges = new Map<string, Set<string>>();
  const rootEdges = new Set<string>();
  for (const { query, owner, available } of queries) {
    const from = query['from'] as Readonly<Record<string, unknown>> | undefined;
    if (!from) continue;
    const relations = [from, ...((Array.isArray(from['joins']) ? from['joins'] as readonly Readonly<Record<string, unknown>>[] : []).map((join) => (join as Readonly<Record<string, unknown>>)['from'] as Readonly<Record<string, unknown>>))];
    for (const relation of relations) {
      const name = String(relation?.['name'] ?? '');
      const target = name.toLowerCase();
      if (!references.has(target)) continue;
      if (!available.has(target)) throw new Error('Recursive, self, and forward CTE references are not supported.');
      if (relation['schema'] !== undefined || relation['database'] !== undefined || typeof relation['alias'] !== 'string')
        throw new Error('Use an unqualified named CTE reference with an explicit alias.');
      references.set(target, (references.get(target) ?? 0) + 1);
      if (owner) {
        const ownEdges = edges.get(owner.toLowerCase()) ?? new Set<string>();
        ownEdges.add(target);
        edges.set(owner.toLowerCase(), ownEdges);
      } else rootEdges.add(target);
    }
    for (const relation of relations) {
      const target = String(relation?.['name'] ?? '').toLowerCase();
      if (!references.has(target) && relation?.['schema'] !== undefined && relation['schema'] !== 'main')
        throw new Error('Only the main Invoice and Customer sources are supported.');
    }
  }
  if ([...references.values()].some((count) => count !== 1))
    throw new Error('Every authored CTE must be referenced exactly once.');
  const reachable = new Set<string>();
  const visitReachable = (name: string): void => {
    if (reachable.has(name)) return;
    reachable.add(name);
    edges.get(name)?.forEach(visitReachable);
  };
  rootEdges.forEach(visitReachable);
  if (reachable.size !== definitions.length)
    throw new Error('Every authored CTE must be reachable from the root query.');
  return true;
}

/** Share the exact source preflight and guard stripping used by preparation and the worker. */
export function preparePublicSqliteCteStructuralDocument(document: TugQLDocument): TugQLDocument {
  const tree = document.tree;
  if (!tree || !validatePublicSqliteCteSource(tree))
    throw new Error('The bounded CTE profile requires authored CTE definitions.');
  requireCustomerIdParameterSource(tree);
  requireLiteralHavingThreshold(tree);
  const stripQuery = (query: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
    const copy: Record<string, unknown> = { ...query };
    const from = query['from'] as Readonly<Record<string, unknown>> | undefined;
    if (from) {
      copy['from'] = {
        ...from,
        ...(Array.isArray(from['joins']) ? {
          joins: (from['joins'] as readonly Readonly<Record<string, unknown>>[]).map((join) => ({
            ...join,
            from: { ...(join['from'] as Readonly<Record<string, unknown>>) },
          })),
        } : {}),
      };
      if (from['name'] === 'Invoice') delete copy['where'];
    }
    return copy;
  };
  const stripBody = (body: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
    const definitions = body['definitions'] as readonly Readonly<Record<string, unknown>>[] | undefined;
    const query = body['query'] as Readonly<Record<string, unknown>>;
    return {
      ...(definitions ? { definitions: definitions.map((definition) => ({
        ...definition,
        query: stripBody(definition['query'] as Readonly<Record<string, unknown>>),
      })) } : {}),
      query: stripQuery(query),
    };
  };
  const structuralTree = {
    ...tree,
    ...stripBody({ definitions: tree.definitions, query: tree.query }),
  } as unknown as TugQLTree;
  delete (structuralTree as unknown as Record<string, unknown>)['parameters'];
  return { sourceMetadata: document.sourceMetadata, tree: structuralTree };
}

function countSql(expression: RecursiveDTQLExpression, alias: string): string {
  if (Object.keys(expression).some((key) => !['kind', 'function', 'distinct', 'args'].includes(key)))
    throw new Error('The COUNT proof contains an unsupported expression property.');
  if (
    expression.kind !== 'aggregate' ||
    expression.function !== 'count' ||
    expression.distinct === true ||
    expression.args.length !== 1
  ) {
    throw new Error(
      'Grouped Invoice queries support COUNT(*) or COUNT(InvoiceId) only.',
    );
  }
  const argument = expression.args[0];
  if (argument.kind === 'star') {
    if (Object.keys(argument).some((key) => key !== 'kind')) throw new Error('The COUNT proof contains an unsupported star property.');
    return 'COUNT(*)';
  }
  if (
    argument.kind === 'field' &&
    Object.keys(argument).every((key) => key === 'kind' || key === 'field') &&
    Object.keys(argument.field).every((key) => key === 'source' || key === 'field') &&
    argument.field.source === alias &&
    argument.field.field === 'InvoiceId'
  ) {
    return `COUNT(${quoteIdentifier(alias)}.${quoteIdentifier('InvoiceId')})`;
  }
  throw new Error(
    'Grouped Invoice queries support COUNT(*) or COUNT(InvoiceId) only.',
  );
}

/** Preserve parameter identity before resolveTugQL substitutes its value into a literal. */
export function requireCustomerIdParameterSource(tree: TugQLTree): void {
  const parameters = tree.parameters ?? [];
  if (parameters.length !== 1 || parameters[0]?.name !== 'CustomerId' || parameters[0].type.toLowerCase() !== 'integer' || parameters[0].required !== true || parameters[0].default !== undefined)
    throw new Error('Declare one required integer parameter: @CustomerId.');
  const invoices: Readonly<Record<string, unknown>>[] = [];
  const walk = (query: Readonly<Record<string, unknown>>): void => {
    const from = query['from'] as Readonly<Record<string, unknown>> | undefined;
    const joins = Array.isArray(from?.['joins']) ? from['joins'] as readonly Readonly<Record<string, unknown>>[] : [];
    if (from?.['name'] === 'Invoice') invoices.push(query);
    for (const join of joins) {
      const joinedFrom = join['from'] as Readonly<Record<string, unknown>> | undefined;
      if (joinedFrom?.['name'] === 'Invoice') invoices.push(query);
    }
  };
  const visitBody = (body: { readonly definitions?: readonly { readonly kind: string; readonly query?: { readonly definitions?: readonly unknown[]; readonly query?: Readonly<Record<string, unknown>> } }[]; readonly query: Readonly<Record<string, unknown>> }): void => {
    body.definitions?.forEach((definition) => {
      if (definition.kind === 'cte' && definition.query?.query) visitBody(definition.query as never);
    });
    walk(body.query);
  };
  visitBody({ definitions: tree.definitions, query: tree.query });
  if (invoices.length !== 1) throw new Error('The bounded query requires exactly one physical Invoice query.');
  const query = invoices[0] as Readonly<Record<string, unknown>>;
  const from = query['from'] as Readonly<Record<string, unknown>> | undefined;
  const alias = typeof from?.['alias'] === 'string' ? from['alias'] : 'Invoice';
  const where = query['where'] as Readonly<Record<string, unknown>> | undefined;
  const left = where?.['left'] as Readonly<Record<string, unknown>> | undefined;
  const right = where?.['right'] as Readonly<Record<string, unknown>> | undefined;
  if (where?.['op'] !== '==' || left?.['field'] !== 'CustomerId' || (left['source'] !== undefined && left['source'] !== alias) || right?.['param'] !== 'CustomerId') {
    let outerParameter = false;
    const findOuterParameter = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(findOuterParameter); return; }
      const record = value as Readonly<Record<string, unknown>>;
      if (record['param'] === 'CustomerId') outerParameter = true;
      Object.values(record).forEach(findOuterParameter);
    };
    findOuterParameter((tree.query as Readonly<Record<string, unknown>>)['where']);
    if (outerParameter)
      throw new Error('The CustomerId predicate must stay inside the referenced CTE, with no outer WHERE.');
    throw new Error(
      'Use the declared @CustomerId parameter as the value in Invoice.CustomerId equality.',
    );
  }
  let parameterUses = 0;
  const scan = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(scan); return; }
    const record = value as Readonly<Record<string, unknown>>;
    if (record['param'] === 'CustomerId') parameterUses++;
    Object.values(record).forEach(scan);
  };
  scan(tree);
  if (parameterUses !== 1) throw new Error('Use @CustomerId only in the guarded Invoice.CustomerId equality.');
}

/** Validate literal provenance before resolveTugQL replaces parameters with values. */
export function requireLiteralHavingThreshold(tree: TugQLTree): void {
  const visit = (query: Readonly<Record<string, unknown>>): void => {
    const having = query['having'] as Readonly<Record<string, unknown>> | undefined;
    if (having) {
      const right = having['right'] as Readonly<Record<string, unknown>> | undefined;
      if (typeof right?.['value'] !== 'number' || !Number.isSafeInteger(right['value']))
        throw new Error('This SQLite profile requires an integer literal HAVING threshold.');
    }
  };
  const visitBody = (body: { readonly definitions?: readonly { readonly kind: string; readonly query?: unknown }[]; readonly query: Readonly<Record<string, unknown>> }): void => {
    body.definitions?.forEach((definition) => {
      if (definition.kind === 'cte' && definition.query && typeof definition.query === 'object')
        visitBody(definition.query as typeof body);
    });
    visit(body.query);
  };
  visitBody({ definitions: tree.definitions, query: tree.query });
}

/** Deliberately small SQLite lowering for the first browser Author journey. */
export function compilePublicSqliteTugQL(
  resolved: TugQLResolved,
  options: {
    readonly fixtureSha256: string;
    readonly schemaVersion: string;
    readonly draftRevision: number;
    readonly relationship?: PublicSqliteRelationshipReceipt;
    readonly expandedSource?: string;
    readonly authoredSource?: string;
  },
): PublicSqliteQueryPreview {
  const query = resolved.query;
  if (
    query.from.kind === 'query' &&
    query.from.query?.from.kind === 'table' &&
    query.from.query.from.name === 'Invoice' &&
    query.from.joins.length === 1 &&
    query.from.joins[0]?.from.kind === 'table' &&
    query.from.joins[0].from.name === 'Customer'
  )
    return compileCustomerCountCte(resolved, options);
  if (
    query.from.kind === 'query' ||
    query.from.joins.some((join) => join.from.kind === 'query')
  )
    return compileBoundedCteGraph(resolved, options);
  if (query.where !== undefined) {
    throw new Error(
      'Compile only the structurally resolved query with its guarded CustomerId predicate removed.',
    );
  }
  const limit = query.limit;
  const isJoined = query.from.joins.length > 0;
  if (
    query.kind !== 'recursive-dtql' ||
    query.from.kind !== 'table' ||
    query.from.name !== 'Invoice' ||
    (query.from.schema !== undefined && query.from.schema !== 'main') ||
    query.from.joins.length > (isJoined ? 1 : 0) ||
    query.as !== undefined ||
    query.offset !== undefined ||
    limit === undefined ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new Error(
      'This preview supports a bounded Invoice scan or Invoice-to-Customer join only.',
    );
  }

  const join = query.from.joins[0];
  const invoiceAlias = query.from.alias ?? 'Invoice';
  const customerAlias =
    join?.from.kind === 'table' ? (join.from.alias ?? 'Customer') : 'Customer';
  if (isJoined && invoiceAlias.toLowerCase() === customerAlias.toLowerCase())
    throw new Error('Invoice and Customer aliases must be distinct in the join.');
  const onPredicate = join?.on[0];
  const onMatchesRelationship =
    onPredicate?.operator === '==' &&
    ((onPredicate.left.field === 'CustomerId' &&
      onPredicate.left.source === invoiceAlias &&
      onPredicate.right.field === 'CustomerId' &&
      onPredicate.right.source === customerAlias) ||
      (onPredicate.right.field === 'CustomerId' &&
        onPredicate.right.source === invoiceAlias &&
        onPredicate.left.field === 'CustomerId' &&
        onPredicate.left.source === customerAlias));
  if (isJoined) {
    if (
      !options.relationship ||
      options.relationship.id !== PUBLIC_CHINOOK_CUSTOMER_FK ||
      (join?.type !== undefined && join.type.toLowerCase() !== 'inner') ||
      join?.from.kind !== 'table' ||
      join.from.name !== 'Customer' ||
      (join.from.schema !== undefined && join.from.schema !== 'main') ||
      join.on.length !== 1 ||
      join.on[0]?.operator !== '==' ||
      !onMatchesRelationship ||
      options.relationship.fromSource !== (query.from.alias ?? 'Invoice') ||
      options.relationship.toSource !== (join.from.alias ?? 'Customer') ||
      options.relationship.joinType !== 'inner' ||
      options.relationship.pairs.length !== 1 ||
      options.relationship.pairs[0]?.fromField !== 'CustomerId' ||
      options.relationship.pairs[0]?.toField !== 'CustomerId'
    ) {
      throw new Error(
        'This query requires the unique declared Invoice.CustomerId to Customer.CustomerId relationship.',
      );
    }
  } else if (options.relationship) {
    throw new Error(
      'A relationship receipt was supplied for a single-table query.',
    );
  }
  const expectedOrderAlias = query.from.alias ?? 'Invoice';
  if (
    (!isJoined && query.orderBy?.length) ||
    (isJoined &&
      query.orderBy?.length &&
      (query.orderBy.length !== 1 ||
        query.orderBy[0]?.field.source !== expectedOrderAlias ||
        query.orderBy[0]?.field.field !== 'InvoiceId' ||
        query.orderBy[0]?.direction !== 'asc'))
  ) {
    throw new Error('Order joined Invoice rows by InvoiceId ascending.');
  }

  const alias = query.from.alias ?? 'Invoice';
  const columns = query.columns;
  if (!columns?.length || columns.length > (isJoined ? 6 : 2))
    throw new Error('Select the explicit columns supported by this profile.');
  const grouped = query.groupBy !== undefined || query.having !== undefined;
  if (isJoined && grouped)
    throw new Error(
      'Grouped queries are not supported by this joined SQLite profile.',
    );
  let projection: string[];
  let havingSql: string | undefined;
  let havingThreshold: number | undefined;
  if (grouped) {
    const group = query.groupBy?.[0];
    const having = query.having;
    if (
      query.groupBy?.length !== 1 ||
      group?.kind !== 'field' ||
      group.field.source !== alias ||
      group.field.field !== 'CustomerId' ||
      !having ||
      having.kind !== 'comparison' ||
      !Object.hasOwn(SQL_COMPARISON_OPERATORS, having.operator) ||
      having.right.kind !== 'literal' ||
      typeof having.right.value !== 'number' ||
      !Number.isSafeInteger(having.right.value) ||
      columns.length !== 2 ||
      columns[0].expression.kind !== 'field' ||
      columns[0].expression.field.source !== alias ||
      columns[0].expression.field.field !== 'CustomerId'
    ) {
      throw new Error(
        'Grouped Invoice queries require CustomerId, COUNT, an integer HAVING threshold, and a bounded LIMIT.',
      );
    }
    const selectedCount = countSql(columns[1].expression, alias);
    const havingCount = countSql(having.left, alias);
    if (selectedCount !== havingCount)
      throw new Error('Select and filter the same Invoice COUNT expression.');
    const customerIdSql = `${quoteIdentifier(alias)}.${quoteIdentifier('CustomerId')}`;
    projection = [
      `${customerIdSql}${columns[0].as ? ` AS ${quoteIdentifier(columns[0].as)}` : ''}`,
      `${selectedCount}${columns[1].as ? ` AS ${quoteIdentifier(columns[1].as)}` : ''}`,
    ];
    havingSql = `${havingCount} ${SQL_COMPARISON_OPERATORS[having.operator]} ?`;
    havingThreshold = having.right.value;
  } else {
    const allowedColumns = isJoined
      ? new Set([
          'InvoiceId',
          'CustomerId',
          'FirstName',
          'LastName',
          'Email',
        ])
      : new Set(['InvoiceId', 'InvoiceDate']);
    projection = columns.map((column) => {
      const expression = column.expression;
      const invoiceSource =
        expression.kind === 'field' && expression.field.source === alias;
      const customerSource =
        expression.kind === 'field' &&
        expression.field.source === (join?.from.alias ?? 'Customer');
      if (
        expression.kind !== 'field' ||
        (!invoiceSource && !(isJoined && customerSource)) ||
        !allowedColumns.has(expression.field.field)
      ) {
        throw new Error(
          isJoined
            ? 'Only InvoiceId, CustomerId, FirstName, LastName, and Email projections are supported.'
            : 'Only InvoiceId and InvoiceDate projections are supported.',
        );
      }
      const outputName = column.as ?? expression.field.field;
      const fieldSql = `${quoteIdentifier(expression.field.source)}.${quoteIdentifier(expression.field.field)}`;
      return isJoined || column.as
        ? `${fieldSql} AS ${quoteIdentifier(outputName)}`
        : fieldSql;
    });
    const projectedFieldNames = columns.map((column) => {
      const expression = column.expression;
      return expression.kind === 'field' ? expression.field.field : '';
    });
    if (projectedFieldNames[0] !== 'InvoiceId') {
      throw new Error('Project InvoiceId first.');
    }
  }

  const aliases = columns.map(
    (column) =>
      column.as ??
      (column.expression.kind === 'field' ? column.expression.field.field : ''),
  );
  if (
    isJoined &&
    (new Set(aliases).size !== aliases.length || aliases.some((name) => !name))
  )
    throw new Error('Every projected field must have a unique output alias.');
  const outputColumns: readonly PublicSqliteOutputColumn[] = isJoined
    ? Object.freeze(
        columns.map((column, index) => {
          if (column.expression.kind !== 'field')
            throw new Error('Only direct fields can be projected.');
          const { source, field } = column.expression.field;
          const type: PublicSqliteOutputColumn['type'] =
            field === 'InvoiceId' || field === 'CustomerId'
              ? 'integer'
              : 'string';
          return Object.freeze({
            name: aliases[index] as string,
            type,
            lineage: Object.freeze([{ source, field }]),
          });
        }),
      )
    : [];

  const sql = [
    `SELECT ${projection.join(',\n  ')}`,
    `FROM ${quoteIdentifier('Invoice')} AS ${quoteIdentifier(alias)}`,
  ];
  const bindingNames = ['CustomerId'];
  // `requireCustomerIdParameterSource` checks the original author tree before
  // resolution. The resolver receives a parameter-free structural document;
  // this fixed predicate is then added to the same compiler output for preview
  // and execution, without inventing a binding value.
  sql.push(
    `WHERE ${quoteIdentifier(alias)}.${quoteIdentifier('CustomerId')} = ?`,
  );
  if (isJoined && join) {
    const customerAlias = join.from.alias ?? 'Customer';
    const predicate = `${quoteIdentifier(alias)}.${quoteIdentifier('CustomerId')} = ${quoteIdentifier(customerAlias)}.${quoteIdentifier('CustomerId')}`;
    sql.splice(
      2,
      0,
      `INNER JOIN ${quoteIdentifier('Customer')} AS ${quoteIdentifier(customerAlias)} ON ${predicate}`,
    );
  }
  const fixedBindings: (string | number | null)[] = [];
  if (grouped && havingSql !== undefined && havingThreshold !== undefined) {
    sql.push(
      `GROUP BY ${quoteIdentifier(alias)}.${quoteIdentifier('CustomerId')}`,
      `HAVING ${havingSql}`,
    );
    fixedBindings.push(havingThreshold);
    bindingNames.push('HAVING threshold (literal)');
  } else if (grouped) {
    throw new Error(
      'Grouped Invoice queries require CustomerId, COUNT, an integer HAVING threshold, and a bounded LIMIT.',
    );
  }
  if (isJoined)
    sql.push(
      `ORDER BY ${quoteIdentifier(alias)}.${quoteIdentifier('InvoiceId')} ASC`,
    );
  sql.push(`LIMIT ${limit}`);

  return Object.freeze({
    sql: sql.join('\n'),
    fixedBindings: Object.freeze(fixedBindings),
    bindingNames: Object.freeze(bindingNames),
    sourceId: 'chinook-sqlite',
    fixtureSha256: options.fixtureSha256,
    schemaVersion: options.schemaVersion,
    draftRevision: options.draftRevision,
    ...(options.relationship
      ? { relationship: Object.freeze(options.relationship) }
      : {}),
    ...(isJoined ? { outputColumns: Object.freeze(outputColumns) } : {}),
    authorProof: Object.freeze({
      profile: 'invoice-query' as const,
      resolvedQuery: freezeQuery(query),
      ...(options.relationship
        ? { relationship: Object.freeze(options.relationship) }
        : {}),
    }),
    ...(options.expandedSource
      ? { expandedSource: options.expandedSource }
      : {}),
  });
}

/** Compile only the authored single Invoice-count CTE and its explicit Customer key join. */
function compileCustomerCountCte(
  resolved: TugQLResolved,
  options: {
    readonly fixtureSha256: string;
    readonly schemaVersion: string;
    readonly draftRevision: number;
  },
): PublicSqliteQueryPreview {
  const query = resolved.query;
  const relation = query.from;
  const cte = relation.query;
  const innerRelation = cte?.from;
  const join = relation.joins[0];
  const cteAlias = cte?.as ?? '';
  const invoiceAlias = innerRelation?.alias ?? 'Invoice';
  const customerAlias = join?.from.alias ?? 'Customer';
  const keyOutput = cte?.columns?.[0]?.as ?? 'CustomerId';
  const countOutput = cte?.columns?.[1]?.as;
  const innerLimit = cte?.limit;
  const outerLimit = query.limit;
  if (
    query.kind !== 'recursive-dtql' ||
    relation.kind !== 'query' ||
    !cte ||
    relation.name !== undefined ||
    relation.schema !== undefined ||
    !cteAlias ||
    relation.alias !== undefined ||
    relation.joins.length !== 1 ||
    query.where !== undefined ||
    query.as !== undefined ||
    query.offset !== undefined ||
    query.groupBy !== undefined ||
    query.having !== undefined ||
    innerRelation?.kind !== 'table' ||
    innerRelation.name !== 'Invoice' ||
    (innerRelation.schema !== undefined && innerRelation.schema !== 'main') ||
    !invoiceAlias ||
    innerRelation.joins.length !== 0 ||
    cte.where !== undefined ||
    cte.offset !== undefined ||
    cte.orderBy?.length ||
    innerLimit === undefined ||
    !Number.isSafeInteger(innerLimit) ||
    innerLimit < 1 ||
    innerLimit > 100 ||
    outerLimit === undefined ||
    !Number.isSafeInteger(outerLimit) ||
    outerLimit < 1 ||
    outerLimit > 100 ||
    query.orderBy?.length !== 1 ||
    query.orderBy[0]?.field.source !== cteAlias ||
    query.orderBy[0]?.field.field !== keyOutput ||
    query.orderBy[0]?.direction !== 'asc' ||
    join?.type !== 'inner' ||
    join.from.kind !== 'table' ||
    join.from.name !== 'Customer' ||
    (join.from.schema !== undefined && join.from.schema !== 'main') ||
    !customerAlias ||
    join.from.joins.length !== 0 ||
    join.on.length !== 1
  ) {
    throw new Error('This preview supports one bounded Invoice count CTE joined to Customer by its explicit key.');
  }
  if (cteAlias.toLowerCase() === customerAlias.toLowerCase())
    throw new Error('The CTE and Customer aliases must be distinct in the outer query.');
  const group = cte.groupBy?.[0];
  const having = cte.having;
  if (
    cte.groupBy?.length !== 1 ||
    group?.kind !== 'field' ||
    group.field.source !== invoiceAlias ||
    group.field.field !== 'CustomerId' ||
    !having ||
    having.kind !== 'comparison' ||
    !Object.hasOwn(SQL_COMPARISON_OPERATORS, having.operator) ||
    having.right.kind !== 'literal' ||
    typeof having.right.value !== 'number' ||
    !Number.isSafeInteger(having.right.value) ||
    cte.columns?.length !== 2 ||
    cte.columns[0]?.expression.kind !== 'field' ||
    cte.columns[0].expression.field.source !== invoiceAlias ||
    cte.columns[0].expression.field.field !== 'CustomerId' ||
    !keyOutput ||
    !countOutput
  ) {
    throw new Error('The CTE must group Invoice.CustomerId and project its integer COUNT with an integer HAVING literal.');
  }
  if (keyOutput.toLowerCase() === countOutput.toLowerCase())
    throw new Error('The CTE key and count outputs must have distinct names.');
  const countExpression = cte.columns[1].expression;
  const count = countSql(countExpression, invoiceAlias);
  if (countSql(having.left, invoiceAlias) !== count)
    throw new Error('The CTE must select and filter the same Invoice COUNT expression.');
  const joinOn = join.on[0];
  const validOn = joinOn?.operator === '==' &&
    ((joinOn.left.source === cteAlias && joinOn.left.field === keyOutput &&
      joinOn.right.source === customerAlias && joinOn.right.field === 'CustomerId') ||
     (joinOn.right.source === cteAlias && joinOn.right.field === keyOutput &&
      joinOn.left.source === customerAlias && joinOn.left.field === 'CustomerId'));
  if (!validOn)
    throw new Error('Write the Customer join explicitly as totals.CustomerId = c.CustomerId.');
  const columns = query.columns;
  if (!columns || columns.length !== 5)
    throw new Error('Project the CTE key, count, and all three Customer string fields.');
  const names = columns.map((column) => column.as ?? (column.expression.kind === 'field' ? column.expression.field.field : ''));
  if (new Set(names).size !== names.length || names.some((name) => !name))
    throw new Error('Every CTE output must have a unique projection name.');
  const select: string[] = [];
  const outputColumns: PublicSqliteOutputColumn[] = [];
  const customerFields = new Set<string>();
  for (const [index, column] of columns.entries()) {
    const expression = column.expression;
    if (expression.kind !== 'field')
      throw new Error('Project the CTE key, count, and Customer first name, last name, and email.');
    const field = expression.field;
    const isKey = index === 0 && field.source === cteAlias && field.field === keyOutput;
    const isCount = index === 1 && field.source === cteAlias && field.field === countOutput;
    const isCustomer = index > 1 && field.source === customerAlias &&
      ['FirstName', 'LastName', 'Email'].includes(field.field);
    if (!(isKey || isCount || isCustomer) || (isCustomer && customerFields.has(field.field)))
      throw new Error('Project the CTE key, count, and distinct Customer string fields.');
    if (isCustomer) customerFields.add(field.field);
    const name = names[index] as string;
    select.push(`${quoteIdentifier(field.source)}.${quoteIdentifier(field.field)} AS ${quoteIdentifier(name)}`);
    const type = index < 2 ? 'integer' : 'string';
    const lineage = isKey
      ? [{ source: invoiceAlias, field: 'CustomerId' }]
      : isCount
        ? []
        : [{ source: customerAlias, field: field.field }];
    outputColumns.push(Object.freeze({
      name,
      type,
      lineage: Object.freeze(lineage),
    }));
  }
  if (
    customerFields.size !== 3 ||
    !['FirstName', 'LastName', 'Email'].every((field) => customerFields.has(field))
  )
    throw new Error('Project FirstName, LastName, and Email exactly once.');
  const threshold = having.right.value;
  const havingSql = `${count} ${SQL_COMPARISON_OPERATORS[having.operator]} ?`;
  const derived = [
    `SELECT ${quoteIdentifier(invoiceAlias)}.${quoteIdentifier('CustomerId')} AS ${quoteIdentifier(keyOutput)},`,
    `  ${count} AS ${quoteIdentifier(countOutput)}`,
    `FROM ${quoteIdentifier('Invoice')} AS ${quoteIdentifier(invoiceAlias)}`,
    `WHERE ${quoteIdentifier(invoiceAlias)}.${quoteIdentifier('CustomerId')} = ?`,
    `GROUP BY ${quoteIdentifier(invoiceAlias)}.${quoteIdentifier('CustomerId')}`,
    `HAVING ${havingSql}`,
    `LIMIT ${innerLimit}`,
  ].join('\n');
  const sql = [
    `SELECT ${select.join(',\n  ')}`,
    `FROM (\n${derived}\n) AS ${quoteIdentifier(cteAlias)}`,
    `INNER JOIN ${quoteIdentifier('Customer')} AS ${quoteIdentifier(customerAlias)} ON ${quoteIdentifier(cteAlias)}.${quoteIdentifier(keyOutput)} = ${quoteIdentifier(customerAlias)}.${quoteIdentifier('CustomerId')}`,
    `ORDER BY ${quoteIdentifier(cteAlias)}.${quoteIdentifier(keyOutput)} ASC`,
    `LIMIT ${outerLimit}`,
  ].join('\n');
  const proof = Object.freeze({ profile: 'customer-count-cte' as const, resolvedQuery: freezeQuery(query) });
  return Object.freeze({
    sql,
    fixedBindings: Object.freeze([threshold]),
    bindingNames: Object.freeze(['CustomerId', 'HAVING threshold (literal)']),
    sourceId: 'chinook-sqlite',
    fixtureSha256: options.fixtureSha256,
    schemaVersion: options.schemaVersion,
    draftRevision: options.draftRevision,
    outputColumns: Object.freeze(outputColumns),
    authorProof: proof,
  });
}

function freezeQuery<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeQuery(child);
  }
  return value;
}

interface GraphOutput {
  readonly name: string;
  readonly type: PublicSqliteOutputColumn['type'];
  readonly lineage: readonly { readonly source: string; readonly field: string }[];
  readonly leaf?: 'Invoice' | 'Customer';
}

interface CompiledGraphQuery {
  readonly sql: string;
  readonly outputs: readonly GraphOutput[];
  readonly alias: string;
}

/** Independently validates and lowers Core's expanded CTE relation graph. */
function compileBoundedCteGraph(
  resolved: TugQLResolved,
  options: {
    readonly fixtureSha256: string;
    readonly schemaVersion: string;
    readonly draftRevision: number;
    readonly authoredSource?: string;
  },
): PublicSqliteQueryPreview {
  const slots: PublicSqliteBindingSlot[] = [];
  let invoiceLeaves = 0;
  let customerLeaves = 0;
  let explicitJoins = 0;
  let relationNodes = 0;

  const ownKeys = (value: object, allowed: readonly string[], label: string): void => {
    if (Object.keys(value).some((key) => !allowed.includes(key)))
      throw new Error(`The bounded CTE proof contains an unsupported ${label} property.`);
  };
  const allowedFields: Readonly<Record<string, PublicSqliteOutputColumn['type']>> = {
    CustomerId: 'integer',
    InvoiceId: 'integer',
    FirstName: 'string',
    LastName: 'string',
    Email: 'string',
  };
  const resolveField = (
    expression: RecursiveDTQLExpression,
    sources: ReadonlyMap<string, CompiledGraphQuery>,
  ): GraphOutput => {
    ownKeys(expression, ['kind', 'field'], 'field expression');
    if (expression.kind !== 'field')
      throw new Error('Bounded CTE projections and predicates require direct fields.');
    ownKeys(expression.field, ['source', 'field'], 'field reference');
    const source = sources.get(expression.field.source.toLowerCase());
    const output = source?.outputs.find(
      (candidate) => candidate.name.toLowerCase() === expression.field.field.toLowerCase(),
    );
    if (!source || !output || output.name !== expression.field.field)
      throw new Error('The bounded CTE proof references an unknown or ambiguously typed field.');
    return output;
  };

  const compileQuery = (query: RecursiveDTQLQuery, depth: number): CompiledGraphQuery => {
    ownKeys(query, ['kind', 'as', 'from', 'where', 'orderBy', 'limit', 'offset', 'columns', 'groupBy', 'having'], 'query');
    if (
      depth > 3 || query.kind !== 'recursive-dtql' || query.offset !== undefined ||
      !Number.isSafeInteger(query.limit) || (query.limit as number) < 1 || (query.limit as number) > 100 ||
      !query.columns?.length || query.columns.length > 40
    ) throw new Error('Every bounded CTE query requires LIMIT 1..100 and 1..40 explicit columns.');
    relationNodes++;
    if (relationNodes > 10) throw new Error('The bounded CTE graph exceeds ten query/relation nodes.');
    const relation = query.from;
    ownKeys(relation, ['kind', 'name', 'schema', 'alias', 'query', 'joins'], 'relation');
    if (relation.kind === 'query') {
      if (!relation.query || relation.name !== undefined || relation.schema !== undefined || !(relation.alias ?? relation.query.as))
        throw new Error('Every derived CTE reference must be unqualified and explicitly aliased.');
    } else if (relation.kind !== 'table' || relation.query !== undefined) {
      throw new Error('The bounded CTE graph contains an unsupported relation.');
    }
    const fromAlias = relation.alias ?? relation.query?.as ?? (relation.name === 'Invoice' ? 'Invoice' : relation.name === 'Customer' ? 'Customer' : '');
    if (!fromAlias) throw new Error('Every relation in the bounded CTE graph requires an alias.');
    const sourceAliases = new Set<string>();
    const compileRelation = (item: typeof relation): CompiledGraphQuery => {
      ownKeys(item, ['kind', 'name', 'schema', 'alias', 'query', 'joins'], 'relation');
      relationNodes++;
      if (relationNodes > 10) throw new Error('The bounded CTE graph exceeds ten query/relation nodes.');
      if (item.kind === 'query') {
        if (!item.query || item.name !== undefined || item.schema !== undefined || !(item.alias ?? item.query.as))
          throw new Error('Every joined derived CTE reference must be unqualified and explicitly aliased.');
        const child = compileQuery(item.query as RecursiveDTQLQuery, depth + 1);
        const alias = item.alias ?? item.query?.as;
        if (!alias) throw new Error('Every derived CTE reference must be explicitly aliased.');
        return { ...child, sql: `(${child.sql}) AS ${quoteIdentifier(alias)}`, alias };
      }
      if (item.schema !== undefined && item.schema !== 'main')
        throw new Error('Only unqualified main.Invoice and main.Customer sources are supported.');
      if (item.kind !== 'table' || item.query !== undefined || !item.name || (item.name !== 'Invoice' && item.name !== 'Customer'))
        throw new Error('Only the authorized Invoice and Customer physical leaves are supported.');
      if (item.name === 'Invoice') {
        invoiceLeaves++;
        return {
          sql: `${quoteIdentifier('Invoice')} AS ${quoteIdentifier(item.alias ?? 'Invoice')}`,
          alias: item.alias ?? 'Invoice',
          outputs: ['CustomerId', 'InvoiceId'].map((name) => ({
            name,
            type: 'integer' as const,
            lineage: [{ source: item.alias ?? 'Invoice', field: name }],
            leaf: 'Invoice' as const,
          })),
        };
      }
      if (item.name === 'Customer') {
        customerLeaves++;
        return {
          sql: `${quoteIdentifier('Customer')} AS ${quoteIdentifier(item.alias ?? 'Customer')}`,
          alias: item.alias ?? 'Customer',
          outputs: ['CustomerId', 'FirstName', 'LastName', 'Email'].map((name) => ({
            name,
            type: allowedFields[name] as PublicSqliteOutputColumn['type'],
            lineage: [{ source: item.alias ?? 'Customer', field: name }],
            leaf: 'Customer' as const,
          })),
        };
      }
      throw new Error('Only Invoice and Customer physical leaves are supported.');
    };
    const from = compileRelation(relation);
    const sources = new Map<string, CompiledGraphQuery>([[fromAlias.toLowerCase(), from]]);
    const joins = relation.joins;
    if (joins.length > 1) throw new Error('A bounded CTE query supports at most one join.');
    const joinSql: string[] = [];
    for (const join of joins) {
      ownKeys(join, ['type', 'from', 'on', 'hints'], 'join');
      if (join.type !== 'inner' || join.hints !== undefined || join.on.length !== 1)
        throw new Error('The bounded CTE graph requires one explicit INNER equality join.');
      if (join.from.joins.length)
        throw new Error('Nested joins on a joined relation are not supported.');
      explicitJoins++;
      const joined = compileRelation(join.from);
      const alias = join.from.alias ?? join.from.query?.as ?? (join.from.name === 'Customer' ? 'Customer' : '');
      if (!alias || sources.has(alias.toLowerCase()))
        throw new Error('Query-scope relation aliases must be unique ignoring case.');
      sources.set(alias.toLowerCase(), joined);
      const pair = join.on[0];
      ownKeys(pair, ['left', 'operator', 'right'], 'join predicate');
      ownKeys(pair.left, ['source', 'field'], 'join field');
      ownKeys(pair.right, ['source', 'field'], 'join field');
      if (pair?.operator !== '==') throw new Error('The explicit INNER join must be an equality.');
      const left = resolveField({ kind: 'field', field: pair.left }, sources);
      const right = resolveField({ kind: 'field', field: pair.right }, sources);
      const invoiceKey = (field: GraphOutput): boolean => field.type === 'integer' && field.leaf === 'Invoice' && field.lineage.length === 1 && field.lineage[0]?.field === 'CustomerId';
      const customerKey = (field: GraphOutput): boolean => field.type === 'integer' && field.leaf === 'Customer' && field.lineage.length === 1 && field.lineage[0]?.field === 'CustomerId';
      if (!((invoiceKey(left) && customerKey(right)) || (customerKey(left) && invoiceKey(right))))
        throw new Error('The explicit INNER join must connect Invoice.CustomerId and Customer.CustomerId.');
      joinSql.push(`INNER JOIN ${joined.sql} ON ${quoteIdentifier(pair.left.source)}.${quoteIdentifier(pair.left.field)} = ${quoteIdentifier(pair.right.source)}.${quoteIdentifier(pair.right.field)}`);
    }
    for (const [key, source] of sources) {
      if (source.alias.toLowerCase() !== key || source.alias.toLowerCase() !== (key === fromAlias.toLowerCase() ? fromAlias.toLowerCase() : source.alias.toLowerCase()))
        throw new Error('The bounded CTE graph contains an invalid source alias.');
      if (sourceAliases.has(key)) throw new Error('Query-scope aliases must be unique ignoring case.');
      sourceAliases.add(key);
    }

    const grouped = query.groupBy !== undefined || query.having !== undefined;
    const invoiceSource = relation.kind === 'table' && relation.name === 'Invoice';
    const invoiceGroup = invoiceSource && grouped;
    if (invoiceSource && !invoiceGroup)
      throw new Error('The physical Invoice query must group and count by CustomerId.');
    if (grouped && !invoiceGroup) throw new Error('Only the guarded physical Invoice query may aggregate.');
    const columns: GraphOutput[] = [];
    const select: string[] = [];
    for (const column of query.columns) {
      ownKeys(column, ['expression', 'as'], 'projection');
      if (!column.expression) throw new Error('Wildcard projections are not supported in the bounded CTE graph.');
      let output: GraphOutput;
      let sqlExpression: string;
      if (column.expression.kind === 'aggregate') {
        if (!invoiceGroup || relation.kind !== 'table' || relation.name !== 'Invoice')
          throw new Error('COUNT is supported only over the physical Invoice leaf.');
        sqlExpression = countSql(column.expression, relation.alias ?? 'Invoice');
        output = { name: column.as ?? 'count', type: 'integer', lineage: [] };
      } else if (column.expression.kind === 'field') {
        output = resolveField(column.expression, sources);
        sqlExpression = `${quoteIdentifier(column.expression.field.source)}.${quoteIdentifier(column.expression.field.field)}`;
      } else {
        throw new Error('Bounded CTE projections require direct fields or the guarded Invoice COUNT.');
      }
      const name = column.as ?? output.name;
      if (!name || columns.some((prior) => prior.name.toLowerCase() === name.toLowerCase()))
        throw new Error('Output names must be unique ignoring case in each bounded CTE query.');
      columns.push({ ...output, name });
      select.push(`${sqlExpression} AS ${quoteIdentifier(name)}`);
    }

    const clauses: string[] = [`SELECT ${select.join(',\n  ')}`, `FROM ${from.sql}`, ...joinSql];
    if (relation.kind === 'table' && relation.name === 'Invoice') {
      if (invoiceLeaves !== 1 || query.where !== undefined)
        throw new Error('The physical Invoice source must be guarded exactly once by @CustomerId.');
      slots.push({ kind: 'customer-id', name: 'CustomerId' });
      clauses.push(`WHERE ${quoteIdentifier(fromAlias)}.${quoteIdentifier('CustomerId')} = ?`);
    } else if (query.where !== undefined) {
      const where = query.where;
      if (where.kind !== 'comparison')
        throw new Error('WHERE supports only integer fields compared with safe integer literals.');
      if (where.left.kind !== 'field')
        throw new Error('WHERE supports only integer fields compared with safe integer literals.');
      ownKeys(where, ['kind', 'left', 'operator', 'right'], 'WHERE predicate');
      ownKeys(where.left, ['kind', 'field'], 'WHERE field expression');
      ownKeys(where.right, ['kind', 'value'], 'WHERE literal');
      ownKeys(where.left.field, ['source', 'field'], 'WHERE field reference');
      if (!Object.hasOwn(SQL_COMPARISON_OPERATORS, where.operator) || where.right.kind !== 'literal' || typeof where.right.value !== 'number' || !Number.isSafeInteger(where.right.value))
        throw new Error('WHERE supports only integer fields compared with safe integer literals.');
      const field = resolveField(where.left, sources);
      if (field.type !== 'integer') throw new Error('WHERE comparisons require integer fields.');
      slots.push({ kind: 'literal', name: 'WHERE literal', value: where.right.value });
      clauses.push(`WHERE ${quoteIdentifier(where.left.field.source)}.${quoteIdentifier(where.left.field.field)} ${SQL_COMPARISON_OPERATORS[where.operator]} ?`);
    }
    if (invoiceGroup) {
      if (query.groupBy?.[0]) ownKeys(query.groupBy[0], ['kind', 'field'], 'GROUP BY expression');
      if (query.groupBy?.[0]?.kind === 'field') ownKeys(query.groupBy[0].field, ['source', 'field'], 'GROUP BY field reference');
      if (query.having) {
        if (query.having.kind !== 'comparison') throw new Error('HAVING requires a COUNT literal comparison.');
        ownKeys(query.having, ['kind', 'left', 'operator', 'right'], 'HAVING predicate');
        ownKeys(query.having.right, ['kind', 'value'], 'HAVING literal');
      }
      const keyColumn = query.columns.find((column) => column.expression.kind === 'field' && column.expression.field.field === 'CustomerId' && column.expression.field.source === fromAlias);
      const countColumns = query.columns.filter((column) => column.expression.kind === 'aggregate');
      if (query.groupBy?.length !== 1 || query.groupBy[0]?.kind !== 'field' || query.groupBy[0].field.field !== 'CustomerId' || query.groupBy[0].field.source !== fromAlias || query.columns.length !== 2 || !keyColumn || countColumns.length !== 1 || !query.having || query.having.kind !== 'comparison' || !Object.hasOwn(SQL_COMPARISON_OPERATORS, query.having.operator) || query.having.right.kind !== 'literal' || typeof query.having.right.value !== 'number' || !Number.isSafeInteger(query.having.right.value))
        throw new Error('Invoice COUNT requires grouping by CustomerId and a safe integer HAVING threshold.');
      const countExpression = countColumns[0]?.expression;
      if (!countExpression || countSql(query.having.left, fromAlias) !== countSql(countExpression, fromAlias))
        throw new Error('Invoice HAVING must compare the projected physical Invoice COUNT.');
      clauses.push(`GROUP BY ${quoteIdentifier(fromAlias)}.${quoteIdentifier('CustomerId')}`);
      slots.push({ kind: 'literal', name: 'HAVING threshold (literal)', value: query.having.right.value });
      clauses.push(`HAVING ${countSql(query.having.left, fromAlias)} ${SQL_COMPARISON_OPERATORS[query.having.operator]} ?`);
    } else if (query.groupBy !== undefined || query.having !== undefined) {
      throw new Error('Additional aggregate stages are not supported.');
    }
    if (query.orderBy?.length) {
      if (query.orderBy.length !== 1 || query.orderBy[0]?.direction !== 'asc')
        throw new Error('Bounded CTE ordering must use CustomerId ascending.');
      const isRoot = depth === 0;
      const isCustomerLeaf = relation.kind === 'table' && relation.name === 'Customer';
      if (!isRoot && !isCustomerLeaf) throw new Error('Only the root and Customer leaf may specify ordering.');
      const ordered = resolveField({ kind: 'field', field: query.orderBy[0].field }, sources);
      if (ordered.type !== 'integer' || ordered.lineage.length !== 1 || ordered.lineage[0]?.field !== 'CustomerId')
        throw new Error('Stable ordering requires a CustomerId-derived integer key.');
      if (relation.kind === 'table' && relation.name === 'Customer' && query.orderBy[0]?.field.field !== 'CustomerId')
        throw new Error('The physical Customer query must order by Customer.CustomerId before LIMIT.');
      clauses.push(`ORDER BY ${quoteIdentifier(query.orderBy[0].field.source)}.${quoteIdentifier(query.orderBy[0].field.field)} ASC`);
    } else if (depth === 0 || (relation.kind === 'table' && relation.name === 'Customer')) {
      throw new Error('The root and physical Customer query require CustomerId ascending order.');
    }
    clauses.push(`LIMIT ${query.limit}`);
    return { sql: clauses.join('\n'), outputs: columns, alias: query.as ?? fromAlias };
  };

  const compiled = compileQuery(resolved.query, 0);
  if (invoiceLeaves !== 1 || customerLeaves !== 1 || explicitJoins !== 1)
    throw new Error('A bounded CTE graph requires one guarded Invoice leaf, one Customer leaf, and one explicit INNER key join.');
  const outputColumns = Object.freeze(compiled.outputs.map(({ name, type, lineage }) => Object.freeze({ name, type, lineage: Object.freeze([...lineage]) })));
  const bindingNames = Object.freeze(slots.map((slot) => slot.name));
  const fixedBindings = Object.freeze(slots.filter((slot): slot is Extract<PublicSqliteBindingSlot, { kind: 'literal' }> => slot.kind === 'literal').map((slot) => slot.value));
  const root = resolved.query;
  return Object.freeze({
    sql: compiled.sql,
    fixedBindings,
    bindingSlots: Object.freeze(slots),
    bindingNames,
    sourceId: 'chinook-sqlite',
    fixtureSha256: options.fixtureSha256,
    schemaVersion: options.schemaVersion,
    draftRevision: options.draftRevision,
    outputColumns,
    authorProof: Object.freeze({
      profile: 'bounded-cte-query' as const,
      resolvedQuery: freezeQuery(root),
      ...(options.authoredSource !== undefined ? { authoredSource: options.authoredSource } : {}),
    }),
  });
}
