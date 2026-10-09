import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ErrorLogger, IErrorLogger } from '@sneat/core';

@Injectable()
export class NewProjectService {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly router = inject(Router);

  public navigateToNewProjectPage(
    store?: 'github',
    returnUrl = this.router.url,
  ): void {
    const safeReturnUrl = safeNewProjectReturnUrl(returnUrl);
    void this.router
      .navigate(['/new-project'], {
        queryParams: {
          ...(store ? { store } : {}),
          returnUrl: safeReturnUrl,
        },
      })
      .catch(
        this.errorLogger.logErrorHandler(
          'Failed to navigate to the new project page',
        ),
      );
  }
}

/** Only allow a same-app path to be used as the page's Back/Cancel destination. */
export function safeNewProjectReturnUrl(
  value: string | null | undefined,
): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'https://datatug.local');
    if (url.origin !== 'https://datatug.local') return '/';
    if (
      url.pathname === '/new-project' ||
      url.pathname.startsWith('/new-project/')
    )
      return '/';
    // Return destinations should not replay OAuth codes or unrelated query state.
    return url.pathname || '/';
  } catch {
    return '/';
  }
}
