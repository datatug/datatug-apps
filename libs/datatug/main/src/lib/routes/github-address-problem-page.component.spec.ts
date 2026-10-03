import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ProjectUrlErrorReason } from '@datatug/project-address';
import { describe, expect, it, vi } from 'vitest';
import {
  GithubAddressNotices,
  GithubAddressProblem,
  GithubAddressProblemState,
} from './github-project-address-check';
import {
  GithubAddressProblemPageComponent,
  messageForNotFound,
  messageForUnsupported,
} from './github-address-problem-page.component';

// The words for each thing that can be wrong with a short GitHub address (design 3.4a, "Not supported"), as text.

describe('messageForUnsupported', () => {
  it.each([
    [
      'file-link',
      'This is a link to a file',
      "Open the project's folder instead.",
    ],
    ['at-sign-not-supported', 'This address is not supported', '"@"'],
    [
      'dash-directory-not-supported',
      'This address is not supported',
      'named "-"',
    ],
    ['missing-ref', 'This address is not supported', '/tree/'],
    [
      'invalid-owner-or-repo',
      'This address is not supported',
      'datatug.app/project/github.com/<owner>/<repo>',
    ],
    [
      'invalid-path-segment',
      'This address is not supported',
      'datatug.app/project/github.com/<owner>/<repo>',
    ],
    [
      'not-a-project-address',
      'This address is not supported',
      'datatug.app/project/github.com/<owner>/<repo>',
    ],
    [
      'unsupported-store-id',
      'This address is not supported',
      'datatug.app/project/github.com/<owner>/<repo>',
    ],
    [
      'not-representable',
      'This address is not supported',
      'datatug.app/project/github.com/<owner>/<repo>',
    ],
  ] as [ProjectUrlErrorReason, string, string][])(
    '%s',
    (reason, heading, text) => {
      const message = messageForUnsupported(reason);
      expect(message.heading).toBe(heading);
      expect(message.paragraphs.join(' ')).toContain(text);
      expect(message.repo).toBeUndefined();
    },
  );
});

describe('messageForNotFound', () => {
  const problem = (
    extra: Partial<Extract<GithubAddressProblem, { kind: 'not-found' }>> = {},
  ) => ({
    kind: 'not-found' as const,
    owner: 'o',
    repo: 'r',
    folder: '',
    moved: false,
    ...extra,
  });

  it.each([
    [problem(), 'There is no datatug-project.json at the root of o/r.'],
    [
      problem({ folder: 'a/b' }),
      'There is no datatug-project.json at "a/b" in o/r.',
    ],
    [
      problem({ ref: 'v1' }),
      'There is no datatug-project.json at the root of o/r at "v1".',
    ],
    [problem({ ref: 'v1', folder: 'x' }), 'No DataTug project at "x" on "v1".'],
  ])('says where no project was found', (p, text) => {
    const message = messageForNotFound(p);
    expect(message.heading).toBe('No DataTug project here');
    expect(message.paragraphs[0]).toBe(text);
    expect(message.repo).toBe('o/r');
  });

  it('a folder on a ref suggests a branch name with a slash, and the address to use instead', () => {
    const message = messageForNotFound(
      problem({ ref: 'feature', folder: 'x' }),
    );
    expect(message.paragraphs[1]).toContain(
      'If the branch name contains "/", open it by its commit instead',
    );
    expect(message.paragraphs[1]).toContain(
      'datatug.app/project/github.com/o/r/tree/<commit>/x',
    );
  });

  it('a moved repository is said to have moved', () => {
    const message = messageForNotFound(problem({ moved: true }));
    expect(message.paragraphs.join(' ')).toContain('has moved or been renamed');
    expect(message.repo).toBe('o/r');
  });
});

describe('GithubAddressProblemPageComponent', () => {
  function render(
    problem?: GithubAddressProblem,
  ): ComponentFixture<GithubAddressProblemPageComponent> {
    TestBed.configureTestingModule({
      imports: [GithubAddressProblemPageComponent],
      providers: [provideRouter([])],
    }).overrideComponent(GithubAddressProblemPageComponent, {
      set: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    TestBed.inject(GithubAddressProblemState).problem.set(problem);
    const fixture = TestBed.createComponent(GithubAddressProblemPageComponent);
    fixture.detectChanges();
    return fixture;
  }
  const text = (f: ComponentFixture<unknown>) =>
    (f.nativeElement as HTMLElement).textContent ?? '';

  it('shows the heading and the words for an unsupported address, with a way back', () => {
    const f = render({ kind: 'unsupported', reason: 'file-link' });
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe(
      'This is a link to a file',
    );
    expect(text(f)).toContain("Open the project's folder instead.");
    expect(el.querySelector('a[href="/"]')?.textContent).toContain(
      'Back to DataTug',
    );
    expect(el.querySelector('a[href^="https://github.com/"]')).toBeNull();
  });

  it('shows "No DataTug project here" with the repository\'s GitHub link', () => {
    const f = render({
      kind: 'not-found',
      owner: 'o',
      repo: 'r',
      folder: 'dir',
      moved: false,
    });
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('No DataTug project here');
    const link = el.querySelector(
      'a[href^="https://github.com/"]',
    ) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://github.com/o/r');
    expect(link.textContent).toContain('Open o/r on GitHub');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows the generic message when no problem was recorded (a page restored with no state)', () => {
    const f = render(undefined);
    expect(text(f)).toContain('This address is not supported');
  });

  it('puts what came from the address on the page as text, never as markup', () => {
    const f = render({
      kind: 'not-found',
      owner: 'o',
      repo: 'r',
      ref: '<img src=x onerror="window.__pwned=1">',
      folder: '<b>bold</b>',
      moved: false,
    });
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(text(f)).toContain('<b>bold</b>');
    expect(text(f)).toContain('<img src=x onerror="window.__pwned=1">');
    expect(
      (window as unknown as Record<string, unknown>)['__pwned'],
    ).toBeUndefined();
  });
});

describe('GithubAddressNotices', () => {
  it('tells the visit, in a toast, that the address is kept as typed and its history is separate', async () => {
    const present = vi.fn(async () => undefined);
    const create = vi.fn<
      (options: Record<string, unknown>) => Promise<{ present: typeof present }>
    >(async () => ({ present }));
    TestBed.configureTestingModule({
      providers: [{ provide: ToastController, useValue: { create } }],
    });
    TestBed.inject(GithubAddressNotices).defaultBranchUnknown('o', 'r', 'main');
    await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(1));
    const message = String(create.mock.calls[0][0]['message']);
    expect(message).toContain('"main"');
    expect(message).toContain('o/r');
    expect(message).toContain('kept as typed');
    expect(message).toContain('history is kept separately');
    expect(create.mock.calls[0][0]['duration']).toBeGreaterThan(0);
  });
});
