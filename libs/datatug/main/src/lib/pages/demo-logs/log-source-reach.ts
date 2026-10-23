// Which log sources the page may read from where it is served. A hosted page (datatug.app) must never
// make the visitor's browser call their own machine or network (REQ:logs-read-in-place): loopback and
// private-network sources are read only when the app itself is served from loopback (`datatug serve`).
import { InjectionToken } from '@angular/core';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Loopback, private, link-local, shared-address and local-only names; hostnames as URL.hostname spells them. */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
  const v4 = IPV4.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    return v6 === '::' || v6 === '::1' || v6.startsWith('::ffff:') || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }
  return false;
}

export function isLocalNetworkUrl(url: string): boolean {
  try { return isLocalNetworkHost(new URL(url).hostname); } catch { return true; }
}

/** True when the app itself is served from the visitor's own machine. */
export const APP_SERVED_FROM_LOOPBACK = new InjectionToken<boolean>('app is served from loopback', {
  providedIn: 'root',
  factory: () => {
    const hostname = globalThis.location?.hostname ?? '';
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname.endsWith('.localhost');
  },
});

export const LOCAL_SOURCE_ON_HOSTED_MESSAGE =
  'This log source runs on a local machine, so the hosted app does not read it. Run datatug serve locally to read it, or choose a public source.';
