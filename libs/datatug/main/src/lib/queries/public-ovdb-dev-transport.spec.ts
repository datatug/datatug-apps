import { describe, expect, it, vi } from 'vitest';
import {
  createPublicOvdbDevFetch,
  PUBLIC_OVDB_LOOPBACK_MODE,
} from './public-ovdb-dev-transport';

const origin = 'http://127.0.0.1:4330';
const url = 'https://cloud.openvaultdb.com/v1/tugql';
const post = {
  method: 'POST',
  headers: { 'Content-Type': 'application/yaml' },
  body: 'from: items',
};

describe('application-owned public OVDB development transport', () => {
  it('keeps production fetch arguments and explicit bearer requests direct', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    expect(createPublicOvdbDevFetch(null, fetcher)).toBe(fetcher);
    const direct = createPublicOvdbDevFetch(
      PUBLIC_OVDB_LOOPBACK_MODE,
      fetcher,
      origin,
    );
    const authorized = {
      ...post,
      headers: { Authorization: 'Bearer explicit-ovdb-token' },
    };
    await direct(url, authorized);
    expect(fetcher).toHaveBeenLastCalledWith(url, authorized);
    const cookies = { ...post, credentials: 'include' as const };
    await direct(url, cookies);
    expect(fetcher).toHaveBeenLastCalledWith(url, cookies);
    const protectedHeaders = { ...post, headers: { 'X-API-Key': 'explicit-key' } };
    await direct(url, protectedHeaders);
    expect(fetcher).toHaveBeenLastCalledWith(url, protectedHeaders);
  });

  it('accepts the datatug.localhost dev host as its loopback origin and still refuses other hosts', () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() =>
      createPublicOvdbDevFetch(PUBLIC_OVDB_LOOPBACK_MODE, fetcher, 'http://datatug.localhost:4388'),
    ).not.toThrow();
    expect(() =>
      createPublicOvdbDevFetch(PUBLIC_OVDB_LOOPBACK_MODE, fetcher, 'http://evil.localhost:4388'),
    ).toThrow(/loopback origin/);
  });

  it('preserves the effective Request body, init overrides and abort signal', async () => {
    const controller = new AbortController();
    let forwarded!: Request;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        forwarded = new Request(input, init);
        return new Response('{}');
      });
    const transport = createPublicOvdbDevFetch(
      PUBLIC_OVDB_LOOPBACK_MODE,
      fetcher,
      origin,
    );
    const original = new Request(url, {
      ...post,
      headers: { Authorization: 'old-token' },
    });
    await transport(original, {
      ...post,
      body: 'from: overridden',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/yaml',
      },
    });
    expect(forwarded.url).toBe(`${origin}/__datatug_public_ovdb/cloud/v1/tugql`);
    expect(await forwarded.clone().text()).toBe('from: overridden');
    expect(forwarded.headers.get('Authorization')).toBeNull();
    expect(forwarded.headers.get('Accept')).toBe('application/json');
    expect(forwarded.credentials).toBe('omit');
    expect(forwarded.redirect).toBe('error');
    expect(forwarded.signal.aborted).toBe(false);
    controller.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });

  it('inherits a Request stream body and signal when init does not replace them', async () => {
    const controller = new AbortController();
    const input = new Request(url, { ...post, signal: controller.signal });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    await createPublicOvdbDevFetch(PUBLIC_OVDB_LOOPBACK_MODE, fetcher, origin)(input);
    const init = fetcher.mock.calls[0][1];
    expect(await new Response(init?.body).text()).toBe('from: items');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/yaml');
    controller.abort();
    expect(init?.signal?.aborted).toBe(true);
  });

  it('honors credentials added by init rather than downgrading a Request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const transport = createPublicOvdbDevFetch(
      PUBLIC_OVDB_LOOPBACK_MODE,
      fetcher,
      origin,
    );
    const input = new Request(url, post);
    const init = { headers: { Authorization: 'Bearer override' } };
    await transport(input, init);
    expect(fetcher).toHaveBeenCalledWith(input, init);
    expect(input.bodyUsed).toBe(false);
    expect(await input.text()).toBe('from: items');
  });

  it.each([
    'https://datatug.app',
    'http://evil.test:4330',
    'file:///preview',
    'http://localhost@evil.test:4330',
  ])('fails closed outside loopback: %s', (origin) => {
    expect(() =>
      createPublicOvdbDevFetch(PUBLIC_OVDB_LOOPBACK_MODE, vi.fn(), origin),
    ).toThrow(/loopback/);
  });

  it('cannot proxy arbitrary origins, paths, methods or saved configuration', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const transport = createPublicOvdbDevFetch(
      PUBLIC_OVDB_LOOPBACK_MODE,
      fetcher,
      origin,
    );
    for (const [target, init] of [
      ['https://evil.test/v1/tugql', post],
      [url + '?target=evil', post],
      ['https://cloud.openvaultdb.com/admin', post],
      [url, { method: 'DELETE' }],
    ] as const) {
      await transport(target, init);
      expect(fetcher).toHaveBeenLastCalledWith(target, init);
    }
    expect(() =>
      createPublicOvdbDevFetch(
        'https://evil.test' as typeof PUBLIC_OVDB_LOOPBACK_MODE,
        fetcher,
        origin,
      ),
    ).toThrow(/Unknown/);
  });

  it('maps both fixed hosts, leaving canonical metadata identity to the caller', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const transport = createPublicOvdbDevFetch(
      PUBLIC_OVDB_LOOPBACK_MODE,
      fetcher,
      origin,
    );
    await transport('https://ovdb.demodb.dev/v1/databases/northwind', {
      headers: { Accept: 'application/json' },
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      `${origin}/__datatug_public_ovdb/demodb/v1/databases/northwind`,
    );
  });
});
