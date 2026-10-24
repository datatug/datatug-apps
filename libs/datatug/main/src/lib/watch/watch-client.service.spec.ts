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
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    client = TestBed.inject(WatchClientService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('drops direct credentials and pending input seeds on application principal switch', async () => {
    client.bindPrincipal('alice');
    const connected = client.connect(config, 'p', 'alice-user-token');
    http.expectOne((r) => r.url.endsWith('/identity')).flush(identity);
    await connected;
    expect(client.identity()?.id).toBe('alice');
    client.seed = {
      project: 'p',
      environment: 'demo',
      inputs: { order_id: { type: 'integer', value: '11045' } },
      check: {
        id: 'check1',
        title: 'Private Check',
        version: 1,
        inputs: [],
        steps: [],
      },
    };
    client.bindPrincipal('bob');
    expect(client.identity()).toBeUndefined();
    expect(client.seed).toBeUndefined();
    expect(() => client.inbox()).toThrow(
      'Connect to this project coordinator first',
    );
    http.expectNone(() => true);
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
    request.flush(identity);
    await connect;
    expect(client.identity()).toBeUndefined();
  });
});
