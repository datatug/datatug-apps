import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  WatchClientService,
  coordinatorEndpoint,
} from './watch-client.service';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
import { projectRefToString } from '../core/project-context';

const config = { endpoint: 'http://127.0.0.1:8988', namespace: 'northwind' };
const identity = {
  id: 'alice',
  namespace: 'northwind',
  project: 'p',
  environment: 'demo',
  sharedEditor: false,
  tier: 'free',
  channels: { in_app: true, email: true, sms: false, telegram: false },
  limits: { emailPerDay: 50, smsPerDay: 10 },
};

describe('Watch coordinator user transport', () => {
  let client: WatchClientService, http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatatugApiBaseUrl, useValue: 'https://trusted.test/v0/' },
      ],
    });
    client = TestBed.inject(WatchClientService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('keeps a private Check seed within its exact account, Space, project and environment', () => {
    const ref = {
      storeId: 'firestore',
      spaceID: 'space-one',
      projectId: 'same-id',
    };
    client.seed = {
      project: 'same-id',
      projectRef: projectRefToString(ref),
      principal: 'alice',
      environment: 'dev',
      check: {
        id: 'private-check',
        title: 'Private Check',
        version: 1,
        inputs: [],
        steps: [],
      },
      inputs: {},
    };
    expect(client.seedMatches(ref, 'alice', 'dev')).toBe(true);
    expect(client.seedMatches(ref, 'bob', 'dev')).toBe(false);
    expect(
      client.seedMatches({ ...ref, spaceID: 'space-two' }, 'alice', 'dev'),
    ).toBe(false);
    expect(
      client.seedMatches(
        { ...ref, projectId: 'other-project' },
        'alice',
        'dev',
      ),
    ).toBe(false);
    expect(client.seedMatches(ref, 'alice', 'prod')).toBe(false);
    expect(
      client.seedMatches(
        { ...ref, storeId: 'http-localhost:8989', spaceID: undefined },
        'alice',
        'dev',
      ),
    ).toBe(false);
  });
  it('refuses credential-bearing and nonlocal insecure coordinator descriptors before sending a token', async () => {
    for (const endpoint of [
      'http://remote.test',
      'https://alice:secret@coord.test',
      'https://coord.test?token=secret',
      'https://coord.test#token',
      '/coord',
      'https://coord.test?',
    ])
      expect(() => coordinatorEndpoint(endpoint)).toThrow();
    await expect(
      client.connect(
        { ...config, endpoint: 'http://remote.test' },
        'p',
        'secret',
      ),
    ).rejects.toThrow();
    http.expectNone(() => true);
  });
  it('binds the ephemeral token to the manifest origin and verified project, and never persists it', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const connect = client.connect(config, 'p', 'alice-user-token');
    const request = http.expectOne(
      (r) => r.url === config.endpoint + '/v1/watch/identity',
    );
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer alice-user-token',
    );
    expect(request.request.params.get('namespace')).toBe('northwind');
    expect(request.request.params.get('project')).toBe('p');
    request.flush(identity);
    await connect;
    expect(client.identity()?.id).toBe('alice');
    expect(local).not.toHaveBeenCalled();
    expect(
      client.matches({ ...config, endpoint: 'https://other.test' }, 'p'),
    ).toBe(false);
    client.disconnect();
    expect(client.identity()).toBeUndefined();
    expect(() => client.definitions()).toThrow('Connect');
    local.mockRestore();
  });
  it('rejects a token whose fixed project does not match and clears the session', async () => {
    const connect = client.connect(config, 'p', 'bob-user-token');
    http
      .expectOne((r) => r.url.endsWith('/identity'))
      .flush({ ...identity, project: 'foreign' });
    await expect(connect).rejects.toThrow('project');
    expect(client.identity()).toBeUndefined();
    expect(() => client.definitions()).toThrow('Connect');
  });
  it('does not restore an old identity after a competing disconnect', async () => {
    const connect = client.connect(config, 'p', 'alice-user-token');
    const request = http.expectOne((r) => r.url.endsWith('/identity'));
    client.disconnect();
    expect(request.cancelled).toBe(true);
    await connect;
    expect(client.identity()).toBeUndefined();
  });
  const ref = { storeId: 'firestore', spaceID: '_space', projectId: 'p' };
  const hostedIdentity = {
    ...identity,
    id: 'alice',
    namespace: '_space',
    spaceID: '_space',
    hosted: true,
  };
  it.each(['hosted', 'selfhost'])(
    'cancels the owning pending %s connection and protects a newer owner',
    async (mode) => {
      const oldOwner = {},
        newOwner = {};
      TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken(
        'firebase-alice',
      );
      const pending =
        mode === 'hosted'
          ? client.connectHosted(ref, 'demo', 'alice', oldOwner)
          : client.connect(config, 'p', 'alice-token', oldOwner);
      const request = http.expectOne((r) => r.url.endsWith('/identity'));
      expect(client.ownsConnection(oldOwner)).toBe(true);
      client.disconnectOwned(oldOwner);
      expect(request.cancelled).toBe(true);
      await pending;
      expect(client.identity()).toBeUndefined();
      const fresh =
        mode === 'hosted'
          ? client.connectHosted(ref, 'demo', 'alice', newOwner)
          : client.connect(config, 'p', 'alice-token', newOwner);
      http
        .expectOne((r) => r.url.endsWith('/identity'))
        .flush(mode === 'hosted' ? hostedIdentity : identity);
      await fresh;
      client.disconnectOwned(oldOwner);
      expect(client.identity()?.id).toBe('alice');
      expect(client.ownsConnection(newOwner)).toBe(true);
      client.disconnectOwned(newOwner);
      expect(client.identity()).toBeUndefined();
    },
  );
  it('transfers a matching verified self-host session without giving an old owner cancellation rights', async () => {
    const oldOwner = {},
      newOwner = {};
    const pending = client.connect(config, 'p', 'alice-token', oldOwner);
    http.expectOne((r) => r.url.endsWith('/identity')).flush(identity);
    await pending;
    expect(
      client.adoptConnection(
        newOwner,
        { ...config, endpoint: 'https://other.test' },
        'p',
      ),
    ).toBe(false);
    expect(client.adoptConnection(newOwner, config, 'p')).toBe(true);
    client.disconnectOwned(oldOwner);
    expect(client.identity()?.id).toBe('alice');
    expect(client.ownsConnection(newOwner)).toBe(true);
  });
  it('hands off only a verified self-host session within the exact project/account/environment key', async () => {
    const oldOwner = {},
      newOwner = {},
      scope = '["project@agent","alice","demo"]';
    const pending = client.connect(config, 'p', 'alice-token', oldOwner, scope);
    expect(client.handoffConnection(oldOwner, scope)).toBe(false);
    http.expectOne((r) => r.url.endsWith('/identity')).flush(identity);
    await pending;
    for (const foreign of [
      '["other@agent","alice","demo"]',
      '["project@other-agent","alice","demo"]',
      '["project@agent","bob","demo"]',
      '["project@agent","alice","prod"]',
    ]) {
      expect(client.handoffConnection(oldOwner, foreign)).toBe(false);
      expect(client.claimSelfhostConnection(newOwner, foreign)).toBe(false);
    }
    expect(client.handoffConnection(oldOwner, scope)).toBe(true);
    expect(client.ownsConnection(oldOwner)).toBe(false);
    expect(client.claimSelfhostConnection(newOwner, scope)).toBe(true);
    expect(client.adoptConnection(oldOwner, config, 'p', scope)).toBe(false);
    client.disconnectOwned(oldOwner);
    expect(client.identity()?.id).toBe('alice');
    expect(client.ownsConnection(newOwner)).toBe(true);
    expect(client.handoffConnection(newOwner, scope)).toBe(true);
    expect(client.claimSelfhostConnection({}, 'new-account-or-scope')).toBe(
      false,
    );
    expect(client.identity()).toBeUndefined();
  });
  it('uses the existing Firebase bridge only for the trusted app API and exact hosted scope', async () => {
    const bridge = TestBed.inject(SneatApiAuthTokenBridge);
    bridge.setExplicitToken('firebase-alice');
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const pending = client.connectHosted(ref, 'demo', 'alice');
    const req = http.expectOne(
      'https://trusted.test/v0/datatug/watch/_space/p/demo/v1/watch/identity',
    );
    expect(req.request.headers.get('Authorization')).toBe(
      'Bearer firebase-alice',
    );
    expect(req.request.params.keys()).toEqual([]);
    req.flush(hostedIdentity);
    await pending;
    expect(
      client.matchesHosted({
        spaceID: '_space',
        project: 'p',
        environment: 'demo',
        principal: 'alice',
      }),
    ).toBe(true);
    const definitions = client.definitions();
    http
      .expectOne(
        'https://trusted.test/v0/datatug/watch/_space/p/demo/v1/watch/definitions',
      )
      .flush({ definitions: [] });
    await definitions;
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
    // An unrelated manifest receives only the explicitly entered self-host credential.
    const other = client.connect(
      { endpoint: 'https://untrusted.test', namespace: 'northwind' },
      'p',
      'operator-user',
    );
    const remote = http.expectOne(
      (r) => r.url === 'https://untrusted.test/v1/watch/identity',
    );
    expect(remote.request.headers.get('Authorization')).toBe(
      'Bearer operator-user',
    );
    remote.flush(identity);
    await other;
  });
  it.each(['id', 'spaceID', 'project', 'environment', 'namespace'])(
    'rejects a hosted identity with foreign %s',
    async (field) => {
      TestBed.inject(SneatApiAuthTokenBridge).setExplicitToken(
        'firebase-alice',
      );
      const pending = client.connectHosted(ref, 'demo', 'alice');
      const rejected = expect(pending).rejects.toThrow(
        'account, Space, project and environment',
      );
      http
        .expectOne((r) => r.url.endsWith('/identity'))
        .flush({ ...hostedIdentity, [field]: 'foreign' });
      await rejected;
      expect(client.identity()).toBeUndefined();
    },
  );
  it('cancels a queued hosted mutation before a replacement account token becomes available', async () => {
    const bridge = TestBed.inject(SneatApiAuthTokenBridge);
    bridge.setExplicitToken('firebase-alice');
    const connect = client.connectHosted(ref, 'demo', 'alice');
    http.expectOne((r) => r.url.endsWith('/identity')).flush(hostedIdentity);
    await connect;
    const resolution = bridge.beginAuthentication();
    const pending = client.subscribe({ watchId: 'w', channels: ['email'] });
    const cancelled = expect(pending).rejects.toThrow();
    client.disconnect();
    resolution.resolve('firebase-bob');
    await cancelled;
    http.expectNone((r) => r.method === 'POST');
  });
  it('refreshes a hosted read after 401 through the shared token bridge', async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce('old')
      .mockResolvedValueOnce('fresh');
    TestBed.inject(SneatApiAuthTokenBridge)
      .beginAuthentication()
      .resolveWithTokenResolver(resolver);
    const pending = client.connectHosted(ref, 'demo', 'alice');
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledWith(false));
    const req = http.expectOne((r) => r.url.endsWith('/identity'));
    req.flush({}, { status: 401, statusText: 'Unauthorized' });
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledWith(true));
    const retried = http.expectOne((r) => r.url.endsWith('/identity'));
    expect(retried.request.headers.get('Authorization')).toBe('Bearer fresh');
    retried.flush(hostedIdentity);
    await pending;
  });
});
