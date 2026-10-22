import recovery from './testdata/comparison-recovery.go.json';
import facade from './testdata/comparison-facade.go.json';
import httpFixture from './testdata/comparison-http.go.json';
import {
  decodeResult,
  decodeTypedValue,
  prepareEvidenceChart,
  resolveRowEvidence,
  type EvidenceChartSpec,
} from '@sneat/datatug-semantic';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { DetectiveClientService } from '../detective/detective-client.service';
import { datatugApiRealProviders } from '../services/base/datatug-api.test-helpers';
import { decodeQueryComparison } from '../queries/query-comparison';
import type { AppliedEvidenceRequest } from './applied-evidence';
import {
  readRetainedQueryResponse,
  heldEvidenceIdentity,
} from './retained-evidence-contract';
import { readRetainedExecution } from './retained-open-contract';
import {
  comparisonInputs,
  frozenComparison,
} from './retained-comparison-contract';
import { QueryType } from '../models/definition/query-def';
import { fromProjectQueryWire } from '../queries/project-query-contract';

const scope = {
  projectRef: {
    storeId: 'firestore',
    spaceID: httpFixture.request.spaceID,
    projectId: httpFixture.request.project,
  },
  environment: httpFixture.request.environment,
  actor: 'actor',
};
const openScope = {
  ...scope,
  nativeDatabaseId: httpFixture.open.manifest.session.databaseId,
  nativeProjectId: httpFixture.request.project,
};
const declaration = decodeQueryComparison(httpFixture.request.comparison);
function fixtureQuery(wire: typeof httpFixture.open.savedQuery) {
  if (wire.type !== QueryType.SQL) throw new Error('Expected actual SQL fixture');
  return fromProjectQueryWire({ ...wire, type: QueryType.SQL });
}
function fixtureInputs(wire: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(wire).map(([key, raw]) => {
    const value = decodeTypedValue(raw);
    if (value.type !== 'integer') throw new Error('Expected actual integer fixture');
    return [key, { ...value }];
  }));
}
function fixtureSelector<T extends { rowKey: unknown }>(wire: T) {
  const rowKey = decodeTypedValue(wire.rowKey);
  if (rowKey.type !== 'integer' && rowKey.type !== 'string')
    throw new Error('Expected actual scalar row key');
  return { ...wire, rowKey };
}
const query = fixtureQuery(httpFixture.open.savedQuery);
const chart: EvidenceChartSpec = {
  type: 'timeline',
  selectionId: 'comparison-observations',
  timeline: {
    laneColumn: declaration.projection.laneColumn,
    eventColumn: declaration.projection.eventColumn,
    sequenceColumn: declaration.projection.sequenceColumn,
    timeColumn: declaration.projection.timeColumn,
    clockDomainColumn: declaration.projection.clockDomainColumn,
    precisionColumn: declaration.projection.precisionColumn,
    statusColumn: declaration.projection.statusColumn,
    anchorColumn: declaration.projection.anchorColumn,
    evidenceRefColumn: 'evidence_ref',
    timeMode: 'elapsed',
  },
};
async function admitted(wire: unknown = httpFixture.run) {
  return readRetainedQueryResponse(
    wire,
    scope,
    httpFixture.request.queryId,
    { incidentRef: httpFixture.run.attachedIncidentRef },
    { declaration, inputs: httpFixture.request.inputs },
  );
}
describe('Actual Go retained comparison protocol', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('round-trips actual aliased/no_row_key pair through retained admission, elapsed preparation and exact Inspect', async () => {
    for (const fixture of [httpFixture, facade]) {
      const localScope = {
        ...scope,
        projectRef: {
          ...scope.projectRef,
          spaceID: fixture.request.spaceID,
          projectId: fixture.request.project,
        },
      };
      const response = await readRetainedQueryResponse(
        fixture.run,
        localScope,
        fixture.request.queryId,
        { incidentRef: fixture.run.attachedIncidentRef },
        {
          declaration: decodeQueryComparison(fixture.request.comparison),
          inputs: fixture.request.inputs,
        },
      );
      expect(response.result).toEqual(fixture.run.result);
      expect(response.comparison).toEqual(fixture.run.comparison);
      expect(
        response.result.recordset.columns.some((c) => c.name === 'row_key'),
      ).toBe(false);
      const identity = heldEvidenceIdentity(response, localScope);
      if (!identity) throw new Error('missing actual admitted identity');
      const prepared = await prepareEvidenceChart(
        chart,
        response.result,
        identity,
      );
      expect(prepared.rows.map((r) => [r.group, r.elapsedMs])).toEqual([
        ['attempt-11038-1', 0],
        ['attempt-11038-1', 1000],
        ['attempt-11038-1', 2000],
        ['attempt-11038-1', 3000],
        ['attempt-11038-1', 4000],
        ['attempt-11045-1', 0],
        ['attempt-11045-1', 1000],
        ['attempt-11045-1', 2000],
        ['attempt-11045-1', 3000],
      ]);
      const blocked = prepared.rows.find((r) => r.status === 'fail');
      expect(blocked?.inspections[0].selector.rowKey).toEqual({
        type: 'string',
        value: 'attempt-11045-1-e4',
      });
      for (const row of prepared.rows)
        expect(
          await resolveRowEvidence(
            response.result,
            row.inspections[0].selector,
          ),
        ).toBeDefined();
      expect(response.result).toEqual(fixture.run.result);
    }
  });
  it('prepares the verbatim real correction/replay/fresh-order fixture and preserves old held data', async () => {
    for (const name of [
      'initial',
      'correction',
      'replay',
      'freshInitial',
      'freshReplay',
    ] as const) {
      const value = recovery[name],
        req = value.request;
      const localScope = {
        ...scope,
        projectRef: {
          ...scope.projectRef,
          spaceID: req.spaceID,
          projectId: req.project,
        },
      };
      const response = await readRetainedQueryResponse(
        value.run,
        localScope,
        req.queryId,
        { incidentRef: value.run.attachedIncidentRef },
        {
          declaration: decodeQueryComparison(req.comparison),
          inputs: req.inputs,
        },
      );
      const identity = heldEvidenceIdentity(response, localScope);
      if (!identity) throw new Error('missing identity');
      const prepared = await prepareEvidenceChart(
        chart,
        response.result,
        identity,
      );
      const replay = name === 'replay' || name === 'freshReplay';
      expect(new Set(prepared.rows.map((r) => r.group)).size).toBe(
        replay ? 3 : 2,
      );
      expect(prepared.rows.length).toBe(replay ? 12 : 9);
      const order = name.startsWith('fresh') ? '11062' : '11045';
      expect(
        prepared.rows
          .filter((r) => r.group === 'attempt-' + order + '-2')
          .map((r) => r.elapsedMs),
      ).toEqual(replay ? [0, 1000, 2000] : []);
      expect(
        prepared.rows.flatMap((r) => r.inspections.map((i) => i.selector)),
      ).toEqual(value.inspectSelectors);
      expect(response.result).toEqual(value.run.result);
    }
    expect(recovery.initial.run.result.recordset.rows).toEqual(
      recovery.correction.run.result.recordset.rows,
    );
    expect(recovery.replay.run.result.recordset.rows.slice(0, 9)).toEqual(
      recovery.initial.run.result.recordset.rows,
    );
    const recoveryScope = {
      ...openScope,
      projectRef: {
        ...scope.projectRef,
        spaceID: recovery.initial.request.spaceID,
        projectId: recovery.initial.request.project,
      },
      nativeProjectId: recovery.initial.request.project,
    };
    const fresh = await readRetainedExecution(
      recovery.heldFresh,
      {
        ...recoveryScope,
        nativeDatabaseId: recovery.heldFresh.manifest.session.databaseId,
      },
      recovery.freshInitial.run.result.execution,
    );
    expect(fresh.result).toEqual(recovery.freshInitial.run.result);
    const old = await readRetainedExecution(
      recovery.heldInitial,
      {
        ...recoveryScope,
        nativeDatabaseId: recovery.heldInitial.manifest.session.databaseId,
      },
      recovery.initial.run.result.execution,
    );
    expect(old.result).toEqual(recovery.initial.run.result);
    const original = recovery.recoveryOriginalOpen;
    const opened = await readRetainedExecution(
      original.response,
      {
        ...recoveryScope,
        nativeDatabaseId: original.response.manifest.session.databaseId,
      },
      original.request.selector.execution,
      fixtureSelector(original.request.selector),
    );
    expect(opened.originalEvidence?.status).toBe('available');
  });
  it('preserves the same canonical control name through frozen admission and cold input decoding', async () => {
    // A decoder-composition name variant of actual Go data, not a new Go receipt
    // or an assertion that a changed query's opaque revision can be client-hashed.
    const live = structuredClone(httpFixture.run),
      cold = structuredClone(httpFixture.execution);
    const rename = (value: object) => {
      const input = Object.getOwnPropertyDescriptor(
        value,
        'comparison_order_id',
      );
      if (!input) throw new Error('Missing fixture control');
      Object.defineProperty(value, '__proto__', input);
      Reflect.deleteProperty(value, 'comparison_order_id');
    };
    for (const value of [live.comparison, cold.comparison]) {
      value.declaration.controlInput = '__proto__';
      rename(value.inputs);
    }
    rename(cold.inputs);
    cold.savedQuery.comparison.controlInput = '__proto__';
    const parameter = cold.savedQuery.parameters.find(
      (p) => p.id === 'comparison_order_id',
    );
    if (!parameter) throw new Error('Missing declared control');
    parameter.id = '__proto__';
    cold.savedQuery.text = cold.savedQuery.text.replaceAll(
      'comparison_order_id',
      '__proto__',
    );
    const frozen = frozenComparison(
      fixtureQuery(cold.savedQuery),
      live.comparison.inputs,
    );
    expect(frozen?.controlInput).toBe('__proto__');
    const admitted = await readRetainedQueryResponse(
      live,
      scope,
      httpFixture.request.queryId,
      { incidentRef: live.attachedIncidentRef },
      {
        declaration: decodeQueryComparison(frozen),
        inputs: live.comparison.inputs,
      },
    );
    const opened = await readRetainedExecution(
      cold,
      openScope,
      live.result.execution,
    );
    expect(Object.keys(opened.inputs).sort()).toEqual([
      '__proto__',
      'order_id',
    ]);
    expect(Object.hasOwn(opened.inputs, '__proto__')).toBe(true);
    expect(opened.inputs['__proto__']).toEqual({
      type: 'integer',
      value: '11038',
    });
    expect(opened.comparison).toEqual(admitted.comparison);
    expect(opened.result).toEqual(admitted.result);
  });
  it('opens actual control original while retaining affected scalar manifest, and cold reopens original declaration', async () => {
    const opened = await readRetainedExecution(
      httpFixture.open,
      openScope,
      httpFixture.run.result.execution,
      fixtureSelector(httpFixture.openRequest.selector),
    );
    expect(opened.comparison).toEqual(httpFixture.open.comparison);
    expect(opened.manifest.inputs['order_id']).toEqual({
      type: 'integer',
      value: '11045',
    });
    expect(opened.originalEvidence?.status).toBe('available');
    if (opened.originalEvidence?.status !== 'available')
      throw new Error('missing actual original');
    expect(opened.originalEvidence.records[2].fields['order_id']).toEqual({
      type: 'integer',
      value: '11038',
    });
    const cold = await readRetainedExecution(
      httpFixture.execution,
      openScope,
      httpFixture.run.result.execution,
    );
    expect(cold.comparison).toEqual(opened.comparison);
    expect(cold.result).toEqual(opened.result);
  });
  it('refuses an original from the other admitted member instead of the exact selected control row', async () => {
    const wire = structuredClone(httpFixture.open);
    wire.originalEvidence.records[2].fields['order_id'] = {
      type: 'integer',
      value: '11045',
    };
    await expect(
      readRetainedExecution(
        wire,
        openScope,
        httpFixture.run.result.execution,
        fixtureSelector(httpFixture.openRequest.selector),
      ),
    ).rejects.toThrow(/Original order/);
  });
  it('freezes actual flat full pair/declaration in the real authenticated HTTP client request', async () => {
    TestBed.configureTestingModule({
      providers: [...datatugApiRealProviders(), DetectiveClientService],
    });
    const client = TestBed.inject(DetectiveClientService),
      http = TestBed.inject(HttpTestingController);
    const inputs = fixtureInputs(httpFixture.request.inputs),
      comparison = decodeQueryComparison(httpFixture.request.comparison);
    const response = firstValueFrom(
      client.runHostedQuery(
        {
          kind: 'cloud',
          storage: 'firestore',
          spaceID: scope.projectRef.spaceID,
          project: scope.projectRef.projectId,
          principal: 'actor',
        },
        httpFixture.request.queryId,
        scope.environment,
        inputs,
        {
          comparison,
          evidence: httpFixture.request
            .evidence as unknown as AppliedEvidenceRequest,
          operationId: httpFixture.request.operationId,
        },
      ),
    );
    inputs['order_id'].value = '11062';
    const request = http.expectOne((r) =>
      r.url.endsWith('/datatug/queries/run_query'),
    );
    expect(request.request.headers.get('Authorization')).toContain('Bearer ');
    expect(request.request.body).toEqual(httpFixture.request);
    request.flush(httpFixture.run);
    expect((await admitted(await response)).comparison).toEqual(
      httpFixture.run.comparison,
    );
    http.verify();
  });
  it.each([
    'missing',
    'null',
    'version',
    'unknown',
    'declaration',
    'inputs',
    'revision',
    'query',
    'manifest',
    'source',
    'execution',
    'scope',
    'row-role',
    'fingerprint',
  ])('refuses substituted %s admission/outer identity', async (mode) => {
    const wire = structuredClone(httpFixture.run);
    switch (mode) {
      case 'missing':
        Reflect.deleteProperty(wire, 'comparison');
        break;
      case 'null':
        Object.assign(wire, { comparison: null });
        break;
      case 'version':
        wire.comparison.version = 2;
        break;
      case 'unknown':
        Object.assign(wire.comparison, { future: true });
        break;
      case 'declaration':
        wire.comparison.declaration.projection.eventColumn = 'artifact';
        break;
      case 'inputs':
        wire.comparison.inputs['order_id'].value = '11062';
        break;
      case 'revision':
        wire.comparison.queryRevision = 'other';
        break;
      case 'query':
        wire.comparison.queryId = 'other';
        break;
      case 'manifest':
        wire.comparison.manifestRef = 'other';
        break;
      case 'source':
        wire.sourcePin.revision.generation = 'foreign';
        break;
      case 'execution':
        wire.result.execution.projectId = 'other';
        break;
      case 'scope':
        wire.sourcePin.environment = 'foreign';
        break;
      case 'row-role':
        wire.result.rowEvidence.rowKeyColumn = 'pair_member';
        break;
      case 'fingerprint':
        wire.result.rowEvidence.recordsetFingerprint = 'e'.repeat(64);
        break;
    }
    await expect(admitted(wire)).rejects.toThrow();
  });
  it('retains canonical input names as own properties without prototype semantics', () => {
    const renamed = { ...declaration, controlInput: '__proto__' };
    const values = comparisonInputs(
      JSON.parse(
        '{"order_id":{"type":"integer","value":"11045"},"__proto__":{"type":"integer","value":"11038"}}',
      ),
      renamed,
    );
    expect(Object.keys(values)).toEqual(['order_id', '__proto__']);
    expect(values['__proto__']).toEqual({ type: 'integer', value: '11038' });
  });
  it.each([
    'zero',
    'negative',
    'overflow',
    'equal',
    'missing',
    'extra',
    'wrapper',
    'set',
  ])(
    'refuses %s input before dispatch without altering scalar semantics',
    (mode) => {
      const inputs: Record<string, unknown> = structuredClone(
        httpFixture.request.inputs,
      );
      if (mode === 'missing')
        Reflect.deleteProperty(inputs, 'comparison_order_id');
      else if (mode === 'extra')
        inputs['other'] = { type: 'integer', value: '3' };
      else if (mode === 'wrapper')
        inputs['comparison_order_id'] = {
          scalar: { type: 'integer', value: '11038' },
        };
      else if (mode === 'set')
        inputs['comparison_order_id'] = {
          set: [{ type: 'integer', value: '11038' }],
        };
      else
        inputs['comparison_order_id'] = {
          type: 'integer',
          value: (
            {
              zero: '0',
              negative: '-1',
              overflow: '9223372036854775808',
              equal: '11045',
            } as Record<string, string>
          )[mode],
        };
      expect(() => comparisonInputs(inputs, declaration)).toThrow();
      const scalar = { ...query };
      Reflect.deleteProperty(scalar, 'comparison');
      expect(frozenComparison(scalar, inputs)).not.toBeDefined();
    },
  );
  it('preserves held table when a declared control/start is genuinely absent or chart mapping disagrees', async () => {
    const response = await admitted(),
      identity = heldEvidenceIdentity(response, scope);
    if (!identity) throw new Error('missing identity');
    // A mixed held result is rejected before it can borrow the original proof.
    expect(() =>
      decodeResult({
        ...response.result,
        recordset: {
          ...response.result.recordset,
          rows: response.result.recordset.rows.slice(5),
        },
      }),
    ).toThrow();
    if (chart.type !== 'timeline') throw new Error('wrong type');
    const wrong: EvidenceChartSpec = {
      ...chart, timeline: { ...chart.timeline, eventColumn: 'artifact' },
    };
    await expect(
      prepareEvidenceChart(wrong, response.result, identity),
    ).rejects.toThrow(/mappings/);
    expect(response.result).toEqual(httpFixture.run.result);
  });
});
