import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { IonicRouteStrategy } from '@ionic/angular/common';
import { provideIonicAngular } from '@ionic/angular/provide';
import { DefaultSneatAppApiBaseUrl, getStoreUrl, SneatApiBaseUrl } from '@sneat/api';
import { provideSneatAuthenticatedProviders } from '@sneat/app-auth';
import { TelegramAuthService } from '@sneat/auth-core';
import { authRoutes, ssoRoutes, TelegramLoginConfig } from '@sneat/auth-ui';
import {
  APP_INFO,
  EnvConfigToken,
  LOGGER_FACTORY,
  loggerFactory,
  TopMenuService,
} from '@sneat/core';
import {
  provideErrorLogger,
  provideSentryAppInitializer,
  provideSneatAnalytics,
} from '@sneat/logging';
import { RANDOM_ID_OPTIONS } from '@sneat/random';
import { DATATUG_AGENT_BASE_URL } from '@sneat/datatug-semantic';
import { routes } from './app/datatug-app-routes';
import { DatatugAppComponent } from './app/datatug-app.component';
import { datatugAppEnvironmentConfig } from './environments/environment';
import { registerIonicons } from './register-ionicons';
import { registerPosthog } from './register-posthog';

if (datatugAppEnvironmentConfig.posthog) {
  registerPosthog(datatugAppEnvironmentConfig.posthog);
}

bootstrapApplication(DatatugAppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(),
    provideErrorLogger(),
    provideIonicAngular(),
    provideAnimationsAsync(),
    { provide: LOGGER_FACTORY, useValue: loggerFactory },
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    {
      provide: SneatApiBaseUrl,
      useValue: datatugAppEnvironmentConfig.useNgrok
        ? `//${location.host}/v0/`
        : datatugAppEnvironmentConfig.firebaseConfig.emulator
          ? location.hostname === '127.0.0.1' ||
            location.hostname === 'localhost'
            ? 'http://127.0.0.1:8090/v0/'
            : 'https://local-api.sneat.ws/v0/'
          : DefaultSneatAppApiBaseUrl,
    },
    { provide: RANDOM_ID_OPTIONS, useValue: { len: 9 } },
    // `libs/datatug/semantic`'s SemanticApiService is `providedIn: 'root'` and reads
    // this token once, synchronously, the first time something injects the service —
    // so this factory resolves the store id from the current URL's `/store/<id>`
    // segment (same shape DatatugNavContextService.processStore parses) at that
    // moment, via `getStoreUrl()` (@sneat/api) so the semantic client hits the exact
    // same origin every other agent call resolves via S2's `buildAgentUrl()`
    // (libs/datatug/main/.../agent-url.ts — that lib is route-lazy-loaded, and
    // @nx/enforce-module-boundaries forbids a static import of a lazy-loaded lib from
    // an eager file like this one, so this inlines the same two-line origin+prefix
    // shape `buildAgentUrl`/`agentBaseUrl` use rather than importing them).
    // '/datatug' MUST match AGENT_API_PATH_PREFIX in that file — every agent
    // endpoint (REQ:agent-path-contract) is registered under it server-side.
    // ASSUMPTION (integration stream S9b): this captures one store id for the app's
    // session — it does not update if the user navigates to a *different* store
    // without a full page reload. Phase 1's journeys only ever operate within one
    // store per session; making this reactive to in-session store switches is a
    // follow-up if that changes. Falls back to the same `localhost:8989` default
    // host:port the token's own factory hard-codes (see
    // datatug-agent-base-url.token.ts) when no `/store/<id>` segment is present yet —
    // an explicit provider here fully replaces that `providedIn: 'root'` default, so
    // it has to reproduce it rather than return `undefined`.
    {
      provide: DATATUG_AGENT_BASE_URL,
      useFactory: (): string => {
        const match = location.pathname.match(/\/store\/([^/]+)/);
        const storeId = match ? decodeURIComponent(match[1]) : 'localhost:8989';
        return `${getStoreUrl(storeId)}/datatug`;
      },
    },
    provideSneatAuthenticatedProviders(datatugAppEnvironmentConfig),
    provideSneatAnalytics(datatugAppEnvironmentConfig),
    TopMenuService,
    TelegramAuthService,
    {
      provide: TelegramLoginConfig,
      useValue: { botID: 'SneatBot', localBotID: 'AlextDevBot' },
    },
    // App-specific providers
    {
      provide: APP_INFO,
      useValue: { appId: 'datatug', appTitle: 'DataTug.app' },
    },
    { provide: EnvConfigToken, useValue: datatugAppEnvironmentConfig },
    // Literal SSO routes must precede DataTug's root/catch-all feature routes.
    provideRouter([...ssoRoutes, ...routes, ...authRoutes]),
    ...(datatugAppEnvironmentConfig.sentry
      ? [provideSentryAppInitializer(datatugAppEnvironmentConfig.sentry)]
      : []),
  ],
}).catch((err) => console.error(err));

registerIonicons();
