import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { DetectiveClientService } from './detective-client.service';
import { isHostedResolveAction } from './hosted-resolve-contract';
import type { HostedIncidentAction } from './hosted-linkage.models';
import {
  datatugApiRealProviders,
  datatugApiTestBaseUrl,
  datatugApiTestToken,
} from '../services/base/datatug-api.test-helpers';
import wire from './testdata/backend-resolve.http.go.json';

const { storage, spaceID, project, operationId, ...rawAction } = wire.request;
const context = {
  kind: 'cloud' as const,
  storage: storage as 'firestore',
  spaceID,
  project,
  principal: rawAction.recovery.receiptActorId,
};
function action() {
  const value = structuredClone(rawAction);
  if (!isHostedResolveAction(value)) throw new Error('Invalid source fixture');
  return value;
}
describe('Resolve real authenticated HTTP client with verbatim Go request/response', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [DetectiveClientService, ...datatugApiRealProviders()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('posts the exact closed original intent and admits original and historical idempotent responses', async () => {
    const client = TestBed.inject(DetectiveClientService),
      http = TestBed.inject(HttpTestingController);
    for (const response of [wire.success, wire.retry]) {
      const promise = firstValueFrom(
        client.incidentAction(context, action(), operationId),
      );
      const request = http.expectOne(
        datatugApiTestBaseUrl + 'datatug/detective/incident_action',
      );
      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('Authorization')).toBe(
        `Bearer ${datatugApiTestToken}`,
      );
      expect(request.request.body).toEqual(wire.request);
      request.flush(structuredClone(response));
      await expect(promise).resolves.toEqual(response);
    }
  });
  it('does not repeat a write on401 and rejects mixed/cross-account intent before transport', async () => {
    const client = TestBed.inject(DetectiveClientService),
      http = TestBed.inject(HttpTestingController);
    const promise = firstValueFrom(
      client.incidentAction(context, action(), operationId),
    );
    const rejected = expect(promise).rejects.toHaveProperty('status', 401);
    http
      .expectOne(datatugApiTestBaseUrl + 'datatug/detective/incident_action')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await rejected;
    http.expectNone(
      datatugApiTestBaseUrl + 'datatug/detective/incident_action',
    );
    await expect(
      firstValueFrom(
        client.incidentAction(
          { ...context, principal: 'another-actor' },
          action(),
        ),
      ),
    ).rejects.toThrow();
    await expect(
      firstValueFrom(
        client.incidentAction(context, {
          ...action(),
          type: 'append-message',
        } as unknown as HostedIncidentAction),
      ),
    ).rejects.toThrow('Resolve fields');
    http.expectNone(
      datatugApiTestBaseUrl + 'datatug/detective/incident_action',
    );
  });
});
