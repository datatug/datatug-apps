import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { IProjectRef } from '../../core/project-context';

// `providedIn: 'root'` — this holds the single current-project ref shared
// app-wide (side menu + routed page must agree on it); a module-listed
// provider would hand every importing standalone component its own copy.
@Injectable({ providedIn: 'root' })
export class ProjectContextService {
  private readonly $current = new BehaviorSubject<IProjectRef | undefined>(
    undefined,
  );
  public readonly current$ = this.$current.asObservable();

  public get current() {
    return this.$current.value;
  }

  public setCurrent(value?: IProjectRef): void {
    this.$current.next(value);
  }
}
