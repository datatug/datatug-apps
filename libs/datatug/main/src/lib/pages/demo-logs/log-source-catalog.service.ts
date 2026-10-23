// Reads the log sources the public demo project declares (`connections/log-sources.json`), once per
// app session, through the anonymous GitHub project reader. `/demo/logs` and the demo record
// browsers are the demo's routes, so the demo project is their scope; the project id is a token so a
// test or a local check can point it at another revision.
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CANONICAL_DEMODB_PROJECT_ID } from '../../core/demo-db-project';
import { GithubProjectReaderService } from '../../services/repo/github/github-project-reader.service';
import { LOG_SOURCES_FILE, LogSourceError, parseLogSources, type LogSource } from './log-source-declarations';

export const LOG_SOURCES_PROJECT_ID = new InjectionToken<string>('project that declares the demo log sources', {
  providedIn: 'root',
  factory: () => CANONICAL_DEMODB_PROJECT_ID,
});

@Injectable({ providedIn: 'root' })
export class LogSourceCatalogService {
  private readonly reader = inject(GithubProjectReaderService);
  private readonly projectId = inject(LOG_SOURCES_PROJECT_ID);
  #sources?: Promise<readonly LogSource[]>;

  /** The declared sources; rejects with a stated reason. A failed read is retried on the next call. */
  sources(): Promise<readonly LogSource[]> {
    if (!this.#sources) {
      const read = this.read();
      this.#sources = read;
      read.catch(() => { if (this.#sources === read) this.#sources = undefined; });
    }
    return this.#sources;
  }

  private async read(): Promise<readonly LogSource[]> {
    let raw: unknown;
    try {
      raw = await firstValueFrom(this.reader.getRawJson<unknown>(this.projectId, LOG_SOURCES_FILE));
    } catch {
      throw new LogSourceError('The project’s log source declarations could not be read. Try again later.');
    }
    if (raw === undefined || raw === null) throw new LogSourceError('This project declares no log sources.');
    try {
      return parseLogSources(raw);
    } catch (error) {
      throw new LogSourceError(`The project’s log source declarations are invalid: ${error instanceof Error ? error.message : 'unknown problem'}`);
    }
  }
}
