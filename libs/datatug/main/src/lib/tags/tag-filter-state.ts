import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { map, of } from 'rxjs';
/** One URL-backed selection per routed list; repeated tag parameters preserve exact tag text. */
@Injectable({ providedIn: 'root' })
export class TagFilterState {
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  readonly selected = toSignal(
    (this.route?.queryParamMap ?? of(convertToParamMap({}))).pipe(
      map((params) => [
        ...new Set((params.getAll?.('tag') ?? []).filter(Boolean)),
      ]),
    ),
    { initialValue: [] },
  );
  set(tags: string[]): void {
    void this.router?.navigate([], {
      relativeTo: this.route,
      queryParams: { tag: tags.length ? tags : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
