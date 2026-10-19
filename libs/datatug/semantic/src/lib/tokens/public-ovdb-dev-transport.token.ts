import { InjectionToken } from '@angular/core';

/** App-owned mode only. Saved query definitions never configure transport. */
export const PUBLIC_OVDB_LOOPBACK_MODE = 'public-ovdb-loopback-v1' as const;
export type PublicOvdbDevTransport = typeof PUBLIC_OVDB_LOOPBACK_MODE;

/** Only the application development environment supplies this mode. */
export const PUBLIC_OVDB_DEV_TRANSPORT = new InjectionToken<PublicOvdbDevTransport>(
  'PUBLIC_OVDB_DEV_TRANSPORT',
);
