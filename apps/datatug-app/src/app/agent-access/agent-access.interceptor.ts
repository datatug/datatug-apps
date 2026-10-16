import {
  HTTP_INTERCEPTORS,
  FetchBackend,
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpHandlerFn,
  HttpInterceptor,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import {
  EnvironmentInjector,
  Injectable,
  Provider,
  inject,
  runInInjectionContext,
} from '@angular/core';
import { Observable, switchMap, tap, throwError } from 'rxjs';
import {
  AGENT_ACTIVE_ORIGIN,
  AgentAccessService,
  AGENT_SESSION_EXCHANGE_PATH,
} from './agent-access.service';
import { loopbackAgentOrigin } from './agent-link-code';

/**
 * Sends a session token only to the current explicit loopback store's `/datatug/` API, after the one-time code of
 * the link has been exchanged for it (see {@link AgentAccessService}). Other origins and paths pass untouched.
 * Agent API redirects are rejected so the bearer header cannot follow a redirect away from that origin.
 * A 401 to a request that carried a token forgets that token, so the next request does not resend it.
 */
export const agentAccessInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const origin = loopbackAgentOrigin(req.url);
  const activeOrigin = inject(AGENT_ACTIVE_ORIGIN, { optional: true });
  if (!origin || !isActiveAgentApiRequest(req.url, origin, activeOrigin?.()))
    return next(req);
  const safeRequest = req.clone({
    redirect: 'error',
    credentials: 'omit',
    withCredentials: false,
    cache: 'no-store',
  });
  if (req.headers.has('Authorization')) return next(safeRequest);
  const access = inject(AgentAccessService);
  return access.tokenFor(origin).pipe(
    switchMap((token) => {
      if (activeOrigin?.() !== origin) {
        return throwError(
          () =>
            new HttpErrorResponse({
              status: 0,
              statusText: 'Agent context changed',
            }),
        );
      }
      return next(
        token
          ? safeRequest.clone({
              setHeaders: { Authorization: `Bearer ${token}` },
            })
          : safeRequest,
      ).pipe(
        tap({
          error: (err: unknown) => {
            if (
              token &&
              err instanceof HttpErrorResponse &&
              err.status === 401
            ) {
              access.forget(origin, token);
            }
          },
        }),
      );
    }),
  );
};

/**
 * The same interceptor for the HttpClient instances that library modules provide themselves
 * (`provideHttpClient(withInterceptorsFromDi())`, `HttpClientModule`): such a client does not run the root's
 * functional interceptors, only the class interceptors registered under {@link HTTP_INTERCEPTORS}, which it resolves
 * from the root. Without it a page's own calls (`exec/select`) would go to the agent without the session token.
 */
@Injectable()
export class AgentAccessDiInterceptor implements HttpInterceptor {
  private readonly injector = inject(EnvironmentInjector);
  private readonly fetchBackend = inject(FetchBackend);
  private readonly activeOrigin = inject(AGENT_ACTIVE_ORIGIN, {
    optional: true,
  });

  intercept(
    req: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    return runInInjectionContext(this.injector, () =>
      agentAccessInterceptor(req, (r) =>
        r.redirect === 'error' &&
        isActiveAgentApiRequest(
          r.url,
          loopbackAgentOrigin(r.url),
          this.activeOrigin?.(),
        )
          ? this.fetchBackend.handle(r)
          : next.handle(r),
      ),
    );
  }
}

function isActiveAgentApiRequest(
  url: string,
  origin: string | undefined,
  activeOrigin: string | undefined,
): boolean {
  if (!origin || origin !== activeOrigin) return false;
  try {
    const pathname = new URL(url, location.href).pathname;
    return (
      pathname.startsWith('/datatug/') &&
      pathname !== AGENT_SESSION_EXCHANGE_PATH
    );
  } catch {
    return false;
  }
}

/** Registers the access interceptor for module-provided HttpClient instances (see {@link AgentAccessDiInterceptor}). */
export function provideAgentAccessForModuleClients(): Provider {
  return {
    provide: HTTP_INTERCEPTORS,
    useClass: AgentAccessDiInterceptor,
    multi: true,
  };
}
