import type { IQueryDef } from '../../models/definition/query-def';
import type { FederatedQueryResult } from '../federated-query-executor';
import { savedPlanIdentity } from './saved-plan-revalidation';
import { graphStableIdentity, assertLocallyVerifiedNativeGraphPlan } from './native-graph-executor';
import { validateRuntimePins } from './runtime-read-pins';

/** Observation timestamps and prior result receipts are descriptive, not query inputs. */
export function runtimePlanIdentity(definition: IQueryDef): string {
  return savedPlanIdentity({
    ...definition,
    publicData: definition.publicData
      ? { ...definition.publicData, observedAt: '' }
      : undefined,
    federation: definition.federation
      ? { ...definition.federation, readReceipt: undefined }
      : undefined,
  });
}

/** An explicit save copies observed pins only into the exact plan that produced them. */
export function saveRuntimePins(
  definition: IQueryDef,
  executed: IQueryDef,
  result: FederatedQueryResult,
): IQueryDef {
  if (!result.runtimeRead) return definition;
  if (
    runtimePlanIdentity(definition) !== runtimePlanIdentity(executed) ||
    (!definition.federation?.bounds?.runtime &&
      !definition.federation?.nativeGraph)
  )
    throw new Error(
      'The selected plan changed after execution. Run it explicitly again before saving runtime pins.',
    );
  if (definition.federation?.nativeGraph) {
    const graph = definition.federation.nativeGraph;
    assertLocallyVerifiedNativeGraphPlan(graph);
    if (
      !result.nativeGraph ||
      result.nativeGraph.planIdentity !== graphStableIdentity(graph)
    )
      throw new Error(
        'The graph result belongs to another stage/pin/selection plan.',
      );
    const databases = result.runtimeRead.pins;
    const expected = Object.fromEntries(
      Object.values(graph.stages).map((stage) => [
        stage.database,
        stage.runtime,
      ]),
    );
    for (const stage of Object.values(graph.stages)) {
      validateRuntimePins(stage.runtime, true);
      if (graphStableIdentity(stage.runtime) !== graphStableIdentity(expected[stage.database]))
        throw new Error('Graph stages disagree about the immutable database pins.');
    }
    const readDatabases = new Set<string>();
    for (const [id, coverage] of Object.entries(result.nativeGraph.coverage)) {
      const stage = graph.stages[id as keyof typeof graph.stages];
      if (!Object.hasOwn(graph.stages, id) || !stage || !coverage || !Array.isArray(coverage.history))
        throw new Error('The graph result has unknown or invalid stage coverage.');
      if (coverage.history.length) readDatabases.add(stage.database);
    }
    if (Object.keys(databases).length !== readDatabases.size ||
      [...readDatabases].some((database) => !Object.hasOwn(databases, database)))
      throw new Error(
        'Every accepted graph read must retain its four exact observed pins; unread databases cannot claim an observation.',
      );
    for (const [database, pins] of Object.entries(databases)) {
      validateRuntimePins(pins, true);
      if (!readDatabases.has(database) || !expected[database] ||
        graphStableIdentity(pins) !== graphStableIdentity(expected[database]))
        throw new Error('The observed graph runtime pins changed or name an undeclared database.');
    }
    return {
      ...definition,
      federation: {
        ...definition.federation,
        nativeGraph: structuredClone(graph),
        readReceipt: structuredClone(result.runtimeRead),
      },
      ...(definition.publicData
        ? {
            publicData: {
              ...definition.publicData,
              graph: structuredClone(graph),
            },
          }
        : {}),
    };
  }
  const bounds = definition.federation?.bounds;
  const runtime = bounds?.runtime;
  if (!bounds || !runtime)
    throw new Error('The immutable runtime configuration is missing.');
  const databases = result.runtimeRead.pins;
  if (
    Object.keys(databases).sort().join(',') !==
    Object.keys(runtime.databases).sort().join(',')
  )
    throw new Error(
      'The result does not cover every declared runtime database.',
    );
  for (const [database, pins] of Object.entries(databases)) {
    validateRuntimePins(pins, true);
    const expected = runtime.databases[database];
    if (
      Object.entries(expected).some(
        ([name, value]) => pins[name as keyof typeof pins] !== value,
      )
    )
      throw new Error(
        'The runtime pins changed. Acknowledge new pins and run explicitly again.',
      );
  }
  return {
    ...definition,
    federation: {
      ...definition.federation,
      readReceipt: structuredClone(result.runtimeRead),
      bounds: {
        ...bounds,
        runtime: { ...runtime, databases: structuredClone(databases) },
      },
    },
  };
}
