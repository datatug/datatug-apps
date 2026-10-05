import type { IQueryDef } from '../../models/definition/query-def';
import type { FederatedQueryResult } from '../federated-query-executor';
import { savedPlanIdentity } from './saved-plan-revalidation';
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
    !definition.federation?.bounds?.runtime
  )
    throw new Error(
      'The selected plan changed after execution. Run it explicitly again before saving runtime pins.',
    );
  const runtime = definition.federation.bounds.runtime;
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
        ...definition.federation.bounds,
        runtime: { ...runtime, databases: structuredClone(databases) },
      },
    },
  };
}
