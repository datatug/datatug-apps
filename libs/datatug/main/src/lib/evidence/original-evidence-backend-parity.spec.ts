import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  type TestRequest,
} from '@angular/common/http/testing';
import {
  decodeResult,
  type RowEvidenceSelector,
} from '@sneat/datatug-semantic';
import { datatugApiRealProviders } from '../services/base/datatug-api.test-helpers';
import { RetainedEvidenceApiService } from './retained-evidence-api.service';
import { originalLogText } from './original-evidence-contract';
import actual from './testdata/backend-original-evidence.json';
import recovery from './testdata/backend-original-recovery.json';

// Verbatim actual Go DAL/POST output, unlike original-evidence.spec-helper.ts.
// Emission/head/hash receipts live beside these JSON files. No rewritten selector,
// pin, schema, original source basename, reader reference or raw byte span.
const cases = [
  {
    name: 'request-created',
    request: actual.availableRequest,
    response: actual.availableResponse,
  },
  {
    name: 'routing-blocked',
    request: actual.blockedRequest,
    response: actual.blockedResponse,
  },
  {
    name: 'not-admitted',
    request: actual.unavailableRequest,
    response: actual.unavailableResponse,
  },
  {
    name: 'recovery-11045',
    request: recovery.recoveryRequest,
    response: recovery.recoveryResponse,
  },
];
async function next(
  http: HttpTestingController,
  suffix: string,
): Promise<TestRequest> {
  let found: TestRequest | undefined;
  await vi.waitFor(() => {
    found = http.match((r) => r.url.endsWith(suffix))[0];
    expect(found).toBeDefined();
  });
  if (!found) throw new Error('Missing current HTTP read');
  return found;
}
describe('Actual Backend original evidence fixture parity through native HTTP client and decoder', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [...datatugApiRealProviders(), RetainedEvidenceApiService],
    }),
  );
  afterEach(() => TestBed.resetTestingModule());
  it.each(cases)(
    'preserves actual $name selected original evidence and independently retained rows',
    async ({ request, response, name }) => {
      const http = TestBed.inject(HttpTestingController),
        api = TestBed.inject(RetainedEvidenceApiService);
      const projectRef = {
        storeId: 'firestore',
        spaceID: request.spaceID,
        projectId: request.projectId,
      };
      const pending = api.openRow(
        {
          projectRef,
          environment: request.environment,
          actor: 'parity-reader',
        },
        decodeResult(response.result),
        request.selector as RowEvidenceSelector,
        new AbortController().signal,
      );
      (await next(http, '/session-context/capabilities')).flush({
        schemaVersion: 1,
        actorId: 'parity-reader',
        databaseId: response.manifest.session.databaseId,
        projectId: request.projectId,
        environments: [
          {
            environmentId: request.environment,
            identityDomain: response.manifest.scope.identityDomain,
          },
        ],
        actions: [],
      });
      const posted = await next(http, '/shipping/evidence/open');
      expect(posted.request.method).toBe('POST');
      expect(posted.request.body).toEqual(request);
      posted.flush(response);
      const value = await pending;
      expect(value.sourcePin).toEqual(response.sourcePin);
      expect(value.result.recordset.rows).toEqual(
        response.result.recordset.rows,
      );
      expect(value.originalEvidence).toEqual(response.originalEvidence);
      const original = value.originalEvidence;
      if (name === 'not-admitted') {
        expect(original).toEqual({
          version: 1,
          status: 'unavailable',
          reason: 'not-admitted',
        });
        expect(value.result.recordset.rows.length).toBeGreaterThan(0);
      } else {
        if (original?.status !== 'available')
          throw new Error('Actual available original was not admitted');
        expect(original.selection).toEqual(request.selector);
        expect(original.records[0].key).toEqual(request.selector.rowKey);
        expect(original.records[3].key).toEqual({
          type: 'integer',
          value: name === 'recovery-11045' ? '18' : '17',
        });
        const log = original.log,
          bytes = atob(log.rawBase64);
        expect(bytes.length).toBe(log.byteEnd - log.byteStart);
        expect(btoa(bytes)).toBe(log.rawBase64);
        const raw = originalLogText(log);
        expect(raw).toBeDefined();
        expect(JSON.parse(raw as string).event_id).toBe(
          request.selector.rowKey.value,
        );
        expect(log.sourceRef).toBe(
          `shipping-original-policy1:original_log:${log.artifactSHA256}:${log.byteStart}:${log.byteEnd}`,
        );
        if (name === 'routing-blocked') {
          expect(original.records[0].fields['kind']).toEqual({
            type: 'string',
            value: 'routing-blocked',
          });
          expect(original.records[4].fields['valid_until']).toEqual({
            type: 'string',
            value: '2018-05-19T00:00:00Z',
          });
        }
        if (name === 'recovery-11045') {
          expect(log.artifact).toBe('logs/recovery-11045.jsonl');
          expect(
            value.sourcePin.revision.artifacts.some(
              (a) => a.id === 'logs/recovery-11062.jsonl',
            ),
          ).toBe(false);
        }
      }
      http.verify(); // Only current namespace + explicit read-only opener, no run/apply.
    },
  );
});
