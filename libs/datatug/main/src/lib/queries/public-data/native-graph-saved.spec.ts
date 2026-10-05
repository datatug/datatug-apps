import { graphFixtureMetadataTransport } from './native-graph.spec-helper';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IQueryDef } from '../../models/definition/query-def';
import { runFederatedQuery } from '../federated-query-executor';
import { NATIVE_GRAPH_PUBLICATION_BLOCKER } from './native-graph-contract';
import {
  NativeGraphExecution,
  nativeGraphRunResponse,
} from './native-graph-executor';
import {
  graphFixturePlan,
  graphFixtureTransport,
} from './native-graph.spec-helper';
import fixture from './native-graph-fixture.json';
import { BoundedRunBudget } from './bounded-run-budget';
import { runtimePlanIdentity, saveRuntimePins } from './saved-runtime-pins';
import { savedPlanIdentity } from './saved-plan-revalidation';

afterEach(() => vi.unstubAllGlobals());
describe('native graph saved inputs do not grant execution authority', () => {
  it('refuses serialized graph eligibility/configuration before any transport', async () => {
    const http = vi.fn();
    vi.stubGlobal('fetch', http);
    const definition = {
      id: 'forged',
      request: { queryType: 'DTQL' },
      federation: {
        ovdbBaseUrl: 'https://runtime.example',
        tables: [],
        nativeGraph: graphFixturePlan(),
      },
      publicData: { eligible: true, execution: 'native-graph' },
    } as unknown as IQueryDef;
    await expect(runFederatedQuery(definition)).rejects.toThrow(
      NATIVE_GRAPH_PUBLICATION_BLOCKER,
    );
    const withoutScenario = { ...definition, publicData: undefined };
    await expect(runFederatedQuery(withoutScenario)).rejects.toThrow(
      NATIVE_GRAPH_PUBLICATION_BLOCKER,
    );
    expect(http).not.toHaveBeenCalled();
  });
  it('copies every observed database pin only for the exact executed graph and keeps reopening idle', async () => {
    const plan = graphFixturePlan(),
      budget = new BoundedRunBudget(5242880, 10000);
    try {
      const execution = new NativeGraphExecution(
        plan,
        fixture.multiplicity.affiliations.map((data, i) => ({
          key: String(i),
          data,
        })),
        budget,
        graphFixtureTransport(plan, fixture.multiplicity),
        'https://runtime.example', graphFixtureMetadataTransport,
      );
      const result = nativeGraphRunResponse(
        execution,
        await execution.run(),
        'saved-fixture',
        'Explicit saved fixture',
      );
      const definition = {
        id: 'saved-fixture',
        request: { queryType: 'DTQL' },
        federation: {
          ovdbBaseUrl: 'https://runtime.example',
          tables: [],
          nativeGraph: plan,
        },
      } as unknown as IQueryDef;
      const saved = saveRuntimePins(definition, definition, result),
        http = vi.fn();
      vi.stubGlobal('fetch', http);
      const reopened = JSON.parse(JSON.stringify(saved)) as IQueryDef;
      expect(reopened.federation?.nativeGraph).toEqual(plan);
      expect(reopened.federation?.readReceipt).toEqual(result.runtimeRead);
      expect(runtimePlanIdentity(reopened)).toBe(
        runtimePlanIdentity(definition),
      );
      expect(http).not.toHaveBeenCalled();
      await expect(runFederatedQuery(reopened)).rejects.toThrow(
        NATIVE_GRAPH_PUBLICATION_BLOCKER,
      );
      expect(http).not.toHaveBeenCalled();
      const changed = structuredClone(definition);
      if (changed.federation?.nativeGraph)
        (changed.federation.nativeGraph as { aliases: boolean }).aliases =
          false;
      expect(savedPlanIdentity(changed)).not.toBe(
        savedPlanIdentity(definition),
      );
      expect(() => saveRuntimePins(changed, definition, result)).toThrow(
        'plan changed',
      );
      const partial = {
        ...result,
        runtimeRead: {
          ...result.runtimeRead,
          pins: { ror: result.runtimeRead.pins['ror'] },
        },
      };
      expect(() => saveRuntimePins(definition, definition, partial)).toThrow(
        'Every accepted graph read',
      );
    } finally {
      budget.close();
    }
  });
  it('saves complete expected pins with only the actual partial read receipts, keeping unread stages unobserved', async () => {
    const plan = graphFixturePlan(false),
      budget = new BoundedRunBudget(5242880, 10000),
      transport = graphFixtureTransport(plan, fixture.multiplicity);
    try {
      const execution = new NativeGraphExecution(plan,
        fixture.multiplicity.affiliations.map((data, index) => ({ key: String(index), data })),
        budget, transport, 'https://runtime.example', graphFixtureMetadataTransport);
      const result = nativeGraphRunResponse(execution, await execution.run(1), 'partial-fixture', 'Explicit partial fixture');
      const definition = { id: 'partial-fixture', request: { queryType: 'DTQL' },
        federation: { ovdbBaseUrl: 'https://runtime.example', tables: [], nativeGraph: plan } } as unknown as IQueryDef;
      const saved = saveRuntimePins(definition, definition, result);
      expect(saved.federation?.nativeGraph).toEqual(plan);
      expect(Object.keys(saved.federation?.readReceipt?.pins ?? {})).toEqual(['ror']);
      expect(result.truncated).toBe(true);
      expect(Object.keys(result.nativeGraph.coverage)).toEqual(['organizations']);
      expect(result.relatedRecordsets.every((set) => set.totalRows === 0)).toBe(true);
      const reopened = JSON.parse(JSON.stringify(saved)) as IQueryDef;
      expect(runtimePlanIdentity(reopened)).toBe(runtimePlanIdentity(definition));
      const unreadPins = plan.stages.places.runtime;
      expect(() => saveRuntimePins(definition, definition, { ...result,
        runtimeRead: { ...result.runtimeRead, pins: { ...result.runtimeRead.pins, geo: unreadPins } } })).toThrow('unread databases');
      expect(() => saveRuntimePins(definition, definition, { ...result,
        runtimeRead: { ...result.runtimeRead, pins: {} } })).toThrow('Every accepted graph read');
      expect(() => saveRuntimePins(definition, definition, { ...result,
        runtimeRead: { ...result.runtimeRead, pins: { ror: { ...plan.stages.organizations.runtime, sourceSha256: 'f'.repeat(64) } } } })).toThrow('pins changed');
      const http = vi.fn(); vi.stubGlobal('fetch', http);
      await expect(runFederatedQuery(reopened)).rejects.toThrow(NATIVE_GRAPH_PUBLICATION_BLOCKER);
      expect(http).not.toHaveBeenCalled();
    } finally { budget.close(); }
  });
});
