import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { DefaultSneatAppApiBaseUrl, SneatApiBaseUrl } from '@sneat/api';
import {
  datatugAppEnvironmentConfig as config,
  datatugEnvironmentProviders,
} from './environments/environment';

/** No application root, auth, tracking, router, interceptors, SDKs or source readers. */
export async function bootstrapPublicPostmortem(token: string) {
  const { PostmortemSharedComponent, POSTMORTEM_SHARE_TOKEN } =
    await import('@sneat/datatug-main/postmortem-shared');
  const root = document.createElement('sneat-postmortem-shared');
  document.body.replaceChildren(root);
  const base = config.useNgrok
    ? `//${location.host}/v0/`
    : config.firebaseConfig.emulator
      ? ['datatug.localhost', 'localhost', '127.0.0.1'].includes(
          location.hostname,
        )
        ? 'http://127.0.0.1:8090/v0/'
        : 'https://local-api.sneat.ws/v0/'
      : DefaultSneatAppApiBaseUrl;
  return bootstrapApplication(PostmortemSharedComponent, {
    providers: [
      ...datatugEnvironmentProviders,
      provideZonelessChangeDetection(),
      provideHttpClient(),
      { provide: SneatApiBaseUrl, useValue: base },
      { provide: POSTMORTEM_SHARE_TOKEN, useValue: token },
    ],
  });
}
