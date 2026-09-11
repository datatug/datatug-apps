import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildGithubProjectSummaryUrl,
  DatatugStoreGithubService,
} from './datatug-store.service.github';
import { GithubProjectReaderService } from './github/github-project-reader.service';

describe('buildGithubProjectSummaryUrl', () => {
  it('defaults to a "datatug" folder when none is given', () => {
    expect(buildGithubProjectSummaryUrl('my-repo@my-org')).toBe(
      'https://raw.githubusercontent.com/my-org/my-repo/main/datatug/datatug-project.json',
    );
  });

  it('uses an explicit folder when a third "@"-separated part is given', () => {
    expect(
      buildGithubProjectSummaryUrl('my-repo@my-org@some-folder'),
    ).toBe(
      'https://raw.githubusercontent.com/my-org/my-repo/main/some-folder/datatug-project.json',
    );
  });

  it('builds the demo project link at the documented URL', () => {
    // https://github.com/datatug/datatug-demo-projects/blob/main/demo-project-1/datatug-project.json
    expect(
      buildGithubProjectSummaryUrl(
        'datatug-demo-projects@datatug@demo-project-1',
      ),
    ).toBe(
      'https://raw.githubusercontent.com/datatug/datatug-demo-projects/main/demo-project-1/datatug-project.json',
    );
  });
});

/**
 * S163 — founder-reported follow-up: every GitHub-store project page logs
 * `ErrorLoggerService.logError: Failed to watch folder "~" of project …
 * at store github.com: not implemented … /folders/~`. These pin down
 * `watchProjectItem()`'s actual, current contract (its own doc comment
 * above already documents the design: only `/folders/~` is implemented,
 * everything else resolves to absent (`null`) rather than an error) as a
 * one-shot read — emits exactly once, completes, never errors — for both
 * the implemented root-folder path and an arbitrary unimplemented one.
 */
describe('DatatugStoreGithubService.watchProjectItem', () => {
  function createService(httpGet: ReturnType<typeof vi.fn>) {
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: httpGet } },
        { provide: GithubProjectReaderService, useValue: {} },
      ],
    });
    return TestBed.inject(DatatugStoreGithubService);
  }

  it('"/folders/~" emits the real root folder once, with no error', () => {
    const httpGet = vi.fn(() =>
      of({
        id: 'datatug-demo-projects@datatug@demo-project-1',
        boards: [{ id: 'board1', title: '1st board' }],
      }),
    );
    const service = createService(httpGet);

    const next = vi.fn();
    const error = vi.fn();
    const complete = vi.fn();
    service
      .watchProjectItem(
        'datatug-demo-projects@datatug@demo-project-1',
        '/folders/~',
      )
      .subscribe({ next, error, complete });

    expect(error).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '~',
        boards: { board1: { name: '1st board' } },
      }),
    );
  });

  it('any other folder path emits absent (null) once, with no error — never "not implemented"', () => {
    const httpGet = vi.fn();
    const service = createService(httpGet);

    const next = vi.fn();
    const error = vi.fn();
    const complete = vi.fn();
    service
      .watchProjectItem(
        'datatug-demo-projects@datatug@demo-project-1',
        '/folders/customers',
      )
      .subscribe({ next, error, complete });

    expect(error).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(null);
    expect(httpGet).not.toHaveBeenCalled();
  });
});
