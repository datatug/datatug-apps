import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { DefaultSneatAppApiBaseUrl, SneatApiBaseUrl } from '@sneat/api';
import { TelegramAuthService } from '@sneat/auth-core';
import { authRoutes } from '@sneat/auth-ui';
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
import { routes } from './app/datatug-app-routes';
import { DatatugAppComponent } from './app/datatug-app.component';
import { datatugAppEnvironmentConfig } from './environments/environment';
import { getAngularFireProviders } from './init-firebase';
import { registerIonicons } from './register-ionicons';
import { registerPosthog } from './register-posthog';

if (datatugAppEnvironmentConfig.posthog) {
  registerPosthog(datatugAppEnvironmentConfig.posthog);
}

bootstrapApplication(DatatugAppComponent, {
  providers: [
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
          ? 'https://local-api.sneat.ws/v0/'
          : DefaultSneatAppApiBaseUrl,
    },
    { provide: RANDOM_ID_OPTIONS, useValue: { len: 9 } },
    ...getAngularFireProviders(datatugAppEnvironmentConfig.firebaseConfig),
    provideSneatAnalytics(datatugAppEnvironmentConfig),
    TopMenuService,
    TelegramAuthService,
    // App-specific providers
    {
      provide: APP_INFO,
      useValue: { appId: 'datatug', appTitle: 'DataTug.app' },
    },
    { provide: EnvConfigToken, useValue: datatugAppEnvironmentConfig },
    provideRouter([...routes, ...authRoutes]),
    ...(datatugAppEnvironmentConfig.sentry
      ? [provideSentryAppInitializer(datatugAppEnvironmentConfig.sentry)]
      : []),
  ],
}).catch((err) => console.error(err));

registerIonicons();
