import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { IProjectRef, projectRefToString } from '../../core/project-context';

/** Project-item cache keyed by the complete selected project reference. */
export class ProjectItemsByAgent<T> {
  private readonly subjects: Record<string, BehaviorSubject<T[]>> = {};

  public getItems$(ref: IProjectRef): Observable<T[]> | undefined {
    const key = projectRefToString(ref);
    const subject = key ? this.subjects[key] : undefined;
    return subject ? this.asObservable(subject) : undefined;
  }

  public getSubject(ref: IProjectRef): BehaviorSubject<T[]> | undefined {
    const key = projectRefToString(ref);
    return key ? this.subjects[key] : undefined;
  }

  public clear(ref: IProjectRef): void {
    const key = projectRefToString(ref);
    if (key) delete this.subjects[key];
  }

  public setItems$(ref: IProjectRef, items: Observable<T[]>): Observable<T[]> {
    const key = projectRefToString(ref);
    if (!key)
      throw new Error('Invalid project reference for project-item cache');
    const subject = new BehaviorSubject<T[]>(undefined as unknown as T[]);
    this.subjects[key] = subject;
    items.subscribe({
      next: (value) => subject.next(value),
      error: (error) => {
        if (this.subjects[key] === subject) this.clear(ref);
        subject.error(error);
      },
    });
    return this.asObservable(subject);
  }

  private asObservable(subject: Subject<T[]>) {
    return subject.asObservable().pipe(filter((value) => value !== undefined));
  }
}
