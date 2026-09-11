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
import { provideBuildInfo } from '@sneat/core-public';
import {
  provideErrorLogger,
  provideSentryAppInitializer,
  provideSneatAnalytics,
} from '@sneat/logging';
import { RANDOM_ID_OPTIONS, RandomIdService } from '@sneat/random';
import { DATATUG_AGENT_BASE_URL } from '@sneat/datatug-semantic';
import { routes } from './app/datatug-app-routes';
import { DatatugAppComponent } from './app/datatug-app.component';
import { buildInfo } from './build-info';
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
    // `@sneat/random`'s `RandomIdService` is `@Injectable()` with no
    // `providedIn` — the package's own `RandomModule` is how it's meant to
    // be provided, but nothing in this app ever imports that module, and
    // this service has no other root provider either. This app's own
    // consumers (`QueryPageComponent`, `QueriesUiService`,
    // `SqlQueryEditorComponent`) all `inject(RandomIdService)` as an eager
    // field initializer, so the dependency is resolved unconditionally at
    // construction time — a direct navigation to `/query/:id` (the context
    // panel's "open a query" hand-off) threw `NG0201: No provider found for
    // \`RandomIdService\`. Source: Standalone[_QueryPageComponent]` for
    // every query, new or existing, well before any code path that
    // actually calls `newRandomId()` ever ran (confirmed live, journey
    // J2/J3, lane S92). Root-providing it here, right next to the
    // `RANDOM_ID_OPTIONS` token its constructor already consumes, fixes all
    // three consumers in the one place this app configures the library.
    RandomIdService,
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
    // Feeds the side menu's build-info footer — @sneat/components'
    // AppVersionComponent (`<sneat-app-version />`, wired in
    // libs/datatug/main/.../menu/datatug-menu.component.html), which
    // injects BUILD_INFO — this app's own stamped build info via the
    // shared @sneat/core-public runtime contract — see build-info.ts and
    // apps/datatug-app/project.json's `stamp-build-info` target.
    provideBuildInfo(buildInfo),
    { provide: EnvConfigToken, useValue: datatugAppEnvironmentConfig },
    // Literal SSO routes must precede DataTug's root/catch-all feature routes.
    provideRouter([...ssoRoutes, ...routes, ...authRoutes]),
    ...(datatugAppEnvironmentConfig.sentry
      ? [provideSentryAppInitializer(datatugAppEnvironmentConfig.sentry)]
      : []),
    // Never interrupt the user with Sentry's "Submit Crash Report" dialog for
    // an error the app already caught and logged (e.g. a 404 while resolving
    // a bad GitHub project id) — only for a genuine, uncaught crash, which
    // `provideSentryAppInitializer()` above still surfaces via its own
    // dialog. `feedback: false` is applied via `ERROR_LOGGER_DEFAULTS`
    // (@sneat/logging 0.27.25+), a token separate from the `ErrorLogger`
    // registration itself, so it survives `provideSneatAuthenticatedProviders()`
    // (`@sneat/app-auth`) also calling `provideErrorLogger()` internally —
    // provider order in this array no longer matters. See
    // node_modules/@sneat/logging/README.md ("App-level defaults").
    ...provideErrorLogger({ feedback: false }),
  ],
}).catch((err) => console.error(err));

registerIonicons();
