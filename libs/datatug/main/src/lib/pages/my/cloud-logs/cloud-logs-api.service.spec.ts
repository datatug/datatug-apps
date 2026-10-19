import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatatugApiService } from '../../../services/base/datatug-api.service';
import { CloudLogsApiService } from './cloud-logs-api.service';

describe('CloudLogsApiService', () => {
  const get = vi.fn();
  const post = vi.fn();

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    TestBed.configureTestingModule({
      providers: [
        CloudLogsApiService,
        { provide: DatatugApiService, useValue: { get, post } },
      ],
    });
  });

  it('uses the authenticated API for OAuth start and connection listing', async () => {
    const listing = {
      grants: [
        {
          id: 'grant-previously-revoked',
          email: 'owner@example.test',
          state: 'active',
          previousRevocationUnconfirmed: true,
        },
      ],
      connections: [],
    };
    get.mockReturnValue(of(listing));
    post.mockReturnValue(
      of({
        authorizationUrl: 'https://accounts.google.com/consent',
        finishKey: 'tab-scoped-key',
      }),
    );
    const service = TestBed.inject(CloudLogsApiService);
    await expect(
      firstValueFrom(service.startGoogleAuthorization()),
    ).resolves.toEqual({
      authorizationUrl: 'https://accounts.google.com/consent',
      finishKey: 'tab-scoped-key',
    });
    await expect(firstValueFrom(service.list())).resolves.toEqual(listing);
    expect(post).toHaveBeenCalledWith(
      'datatug/me/google-log-grants/oauth/start',
      {},
    );
    expect(get).toHaveBeenCalledWith('datatug/me/log-connections');
  });

  it('exchanges an opaque callback receipt with the tab finish key', async () => {
    const grant = {
      id: 'grant-1',
      email: 'owner@example.test',
      state: 'active',
      previousRevocationUnconfirmed: true,
    } as const;
    post.mockReturnValue(of(grant));
    await expect(
      firstValueFrom(
        TestBed.inject(CloudLogsApiService).finishGoogleAuthorization({
          receipt: 'opaque-receipt',
          finishKey: 'tab-scoped-key',
        }),
      ),
    ).resolves.toEqual(grant);
    expect(post).toHaveBeenCalledWith(
      'datatug/me/google-log-grants/oauth/finish',
      { receipt: 'opaque-receipt', finishKey: 'tab-scoped-key' },
    );
  });

  it('sends grant, project and full view identity when probing a connection', async () => {
    const request = {
      grantId: 'grant-1',
      projectId: 'billing-prod',
      logViewId: 'projects/billing-prod/logs/hosted',
    };
    const connection = { id: 'view-1', ...request, active: true };
    post.mockReturnValue(of(connection));
    await expect(
      firstValueFrom(TestBed.inject(CloudLogsApiService).connect(request)),
    ).resolves.toEqual(connection);
    expect(post).toHaveBeenCalledWith('datatug/me/log-connections', request);
  });

  it('keeps query filters bounded to the documented request fields', async () => {
    const request = {
      connectionId: 'view-1',
      from: '2026-10-18T00:00:00.000Z',
      to: '2026-10-19T00:00:00.000Z',
      severity: 'ERROR',
      correlationId: 'corr-7',
      orderId: 'order-8',
      service: 'api',
    };
    const response = {
      entries: [
        {
          timestamp: request.to,
          severity: 'ERROR',
          source: 'api',
          message: 'failed',
          raw: '{"order_id":"order-8"}',
          sourceRef: 'ref-1',
        },
      ],
      capped: false,
      morePossible: false,
    };
    post.mockReturnValue(of(response));
    await expect(
      firstValueFrom(TestBed.inject(CloudLogsApiService).query(request)),
    ).resolves.toEqual(response);
    expect(post).toHaveBeenCalledWith(
      'datatug/me/log-connections/query',
      request,
    );
  });

  it('separates removing a view from account-wide revocation', async () => {
    post
      .mockReturnValueOnce(of({ removed: true }))
      .mockReturnValueOnce(
        of({ state: 'retired', revocationConfirmed: false }),
      );
    const service = TestBed.inject(CloudLogsApiService);
    await expect(firstValueFrom(service.remove('view-1'))).resolves.toEqual({
      removed: true,
    });
    await expect(
      firstValueFrom(service.disconnect('grant-1')),
    ).resolves.toEqual({
      state: 'retired',
      revocationConfirmed: false,
    });
    expect(post).toHaveBeenNthCalledWith(
      1,
      'datatug/me/log-connections/remove',
      { connectionId: 'view-1' },
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      'datatug/me/google-log-grants/disconnect',
      { grantId: 'grant-1', confirm: true },
    );
  });
});
