import {
  HTTP_INTERCEPTORS,
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
import { Observable, switchMap, tap } from 'rxjs';
import { AgentAccessService } from './agent-access.service';
import { loopbackAgentOrigin } from './agent-link-code';

/**
 * Sends the session token of a local agent with every request to it (`Authorization: Bearer <token>`), after the
 * one-time code of the link the page was opened with has been exchanged for it (see {@link AgentAccessService}).
 * Requests to any other origin are passed on untouched: the token never leaves the loopback agent that issued it.
 * A 401 to a request that carried a token forgets that token, so the next request does not resend it.
 */
export const agentAccessInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const origin = loopbackAgentOrigin(req.url);
  if (!origin || req.headers.has('Authorization')) {
    return next(req);
  }
  const access = inject(AgentAccessService);
  return access.tokenFor(origin).pipe(
    switchMap((token) =>
      next(
        token
          ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
          : req,
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
      ),
    ),
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

  intercept(
    req: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    return runInInjectionContext(this.injector, () =>
      agentAccessInterceptor(req, (r) => next.handle(r)),
    );
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
