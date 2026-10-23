import { describe, expect, it } from 'vitest';
import { isLocalNetworkHost, isLocalNetworkUrl } from './log-source-reach';

describe('log source reach', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.9', '169.254.1.1', '100.64.0.1', '0.0.0.0', 'printer.local', '[fd00::1]', '[fe80::1]', '[::ffff:7f00:1]'])('treats %s as local', (host) => {
    expect(isLocalNetworkHost(host)).toBe(true);
  });
  it.each(['ovdb.demodb.dev', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '100.128.0.1'])('treats %s as public', (host) => {
    expect(isLocalNetworkHost(host)).toBe(false);
  });
  it('reads a URL, and treats an unparsable one as local', () => {
    expect(isLocalNetworkUrl('http://127.0.0.1:6832/v1/databases/x')).toBe(true);
    expect(isLocalNetworkUrl('https://ovdb.demodb.dev/v1/databases/x')).toBe(false);
    expect(isLocalNetworkUrl('not a url')).toBe(true);
  });
});
