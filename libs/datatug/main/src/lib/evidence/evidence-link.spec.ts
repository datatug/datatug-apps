import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  evidenceLinkFragment,
  evidenceLinkUrl,
  linkableProject,
  parseEvidenceFragment,
  readEvidenceLink,
  type EvidenceLink,
} from './evidence-link';
import { EvidenceCopyLinkComponent } from './evidence-copy-link.component';

const ref = { storeId: 'firestore', spaceID: 'S1', projectId: 'p1' };
const execution: EvidenceLink = {
  environment: 'demo',
  target: {
    kind: 'execution',
    execution: { storeId: 'firestore', projectId: 'p1', executionId: 'e1' },
  },
};
const checkRun: EvidenceLink = {
  environment: 'demo',
  target: {
    kind: 'check-run',
    checkRun: {
      storeId: 'firestore',
      projectId: 'p1',
      environment: 'demo',
      checkId: 'request-received',
      checkVersion: 2,
      runId: 'r1',
    },
  },
};

function payload(value: unknown): string {
  return (
    'evidence=' +
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  );
}

describe('evidence links', () => {
  it('round-trips an execution and a Check run through the overview fragment, identifiers only', () => {
    for (const link of [execution, checkRun]) {
      const url = evidenceLinkUrl('https://datatug.app', ref, link);
      expect(url).toMatch(
        /^https:\/\/datatug\.app\/space\/S1\/store\/firestore\/project\/p1\/overview#evidence=[A-Za-z0-9_-]+$/,
      );
      const fragment = (url as string).split('#')[1];
      expect(parseEvidenceFragment(fragment, ref)).toEqual(link);
      const decoded = JSON.parse(
        atob(
          fragment
            .slice('evidence='.length)
            .replace(/-/g, '+')
            .replace(/_/g, '/'),
        ),
      );
      expect(Object.keys(decoded).sort()).toEqual([
        'environment',
        'target',
        'v',
      ]);
      expect(url).not.toContain('?');
    }
  });

  it('copies only the closed shape of an execution reference', () => {
    expect(
      readEvidenceLink(
        { v: 1, environment: 'demo', target: execution.target },
        ref,
      ).target,
    ).toEqual(execution.target);
  });

  it('is not an evidence link without the prefix', () => {
    expect(parseEvidenceFragment(null, ref)).toBeUndefined();
    expect(parseEvidenceFragment('', ref)).toBeUndefined();
    expect(parseEvidenceFragment('section-2', ref)).toBeUndefined();
  });

  it.each([
    [
      'an extra field',
      { v: 1, environment: 'demo', target: execution.target, token: 'x' },
    ],
    ['a missing field', { v: 1, target: execution.target }],
    [
      'another version',
      { v: 2, environment: 'demo', target: execution.target },
    ],
    [
      'a bad environment',
      { v: 1, environment: '../x', target: execution.target },
    ],
    [
      'an unknown target field',
      {
        v: 1,
        environment: 'demo',
        target: { ...execution.target, rowKey: 'BOTTM' },
      },
    ],
    [
      'a snapshot',
      {
        v: 1,
        environment: 'demo',
        target: {
          kind: 'snapshot',
          execution: (execution.target as { execution: unknown }).execution,
        },
      },
    ],
    [
      'a source receipt',
      {
        v: 1,
        environment: 'demo',
        target: {
          kind: 'incident',
          incident: { storeId: 'firestore', incidentId: 'i1' },
        },
      },
    ],
    [
      'another project',
      {
        v: 1,
        environment: 'demo',
        target: {
          kind: 'execution',
          execution: {
            storeId: 'firestore',
            projectId: 'p2',
            executionId: 'e1',
          },
        },
      },
    ],
    [
      'another store',
      {
        v: 1,
        environment: 'demo',
        target: {
          kind: 'execution',
          execution: { storeId: 'github', projectId: 'p1', executionId: 'e1' },
        },
      },
    ],
    [
      'a Check run of another environment',
      { v: 1, environment: 'other', target: checkRun.target },
    ],
    [
      'a Check run of another project',
      {
        v: 1,
        environment: 'demo',
        target: {
          kind: 'check-run',
          checkRun: {
            ...(checkRun.target as { checkRun: object }).checkRun,
            projectId: 'p2',
          },
        },
      },
    ],
    [
      'a Check run of another store',
      {
        v: 1,
        environment: 'demo',
        target: {
          kind: 'check-run',
          checkRun: {
            ...(checkRun.target as { checkRun: object }).checkRun,
            storeId: 'github',
          },
        },
      },
    ],
    [
      'a Check version below 1',
      {
        v: 1,
        environment: 'demo',
        target: {
          kind: 'check-run',
          checkRun: {
            ...(checkRun.target as { checkRun: object }).checkRun,
            checkVersion: 0,
          },
        },
      },
    ],
    ['an array', [1]],
    ['null', null],
  ])('rejects %s', (_name, value) => {
    expect(() => parseEvidenceFragment(payload(value), ref)).toThrow(
      'This evidence link cannot be opened.',
    );
  });

  it.each([
    'evidence=',
    'evidence=***',
    'evidence=A',
    'evidence=' + 'A'.repeat(2049),
    'evidence=' + btoa('not json'),
    'evidence=' + btoa('\xff\xfe'),
  ])('rejects the malformed payload %s', (fragment) => {
    expect(() => parseEvidenceFragment(fragment, ref)).toThrow(
      'This evidence link cannot be opened.',
    );
  });

  it('links only native hosted (Space) projects', () => {
    expect(linkableProject(ref)).toBe(true);
    for (const other of [
      undefined,
      { storeId: 'github', projectId: 'p1' },
      { ...ref, branch: 'main' },
      { ...ref, projectApi: 'cloud' as const },
    ]) {
      expect(linkableProject(other as never)).toBe(false);
      expect(
        evidenceLinkUrl('https://datatug.app', other as never, execution),
      ).toBeUndefined();
      expect(() =>
        parseEvidenceFragment(
          evidenceLinkFragment(execution, ref),
          other as never,
        ),
      ).toThrow();
    }
  });
});

describe('EvidenceCopyLinkComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  async function render(link: EvidenceLink | undefined, project = ref) {
    TestBed.configureTestingModule({
      imports: [EvidenceCopyLinkComponent],
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(EvidenceCopyLinkComponent);
    fixture.componentRef.setInput('projectRef', project);
    fixture.componentRef.setInput('environment', link?.environment ?? '');
    fixture.componentRef.setInput('target', link?.target);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  const button = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector('ion-button') as HTMLElement;

  it('copies the link and says who it opens for', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const fixture = await render(checkRun);
    expect(button(fixture).textContent).toContain('Copy link');
    button(fixture).click();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain('Link copied.'),
    );
    expect(writeText).toHaveBeenCalledWith(
      evidenceLinkUrl(location.origin, ref, checkRun),
    );
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    // A different run clears the old confirmation.
    fixture.componentRef.setInput('target', execution.target);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Link copied.');
  });

  it('offers the link to select by hand when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const fixture = await render(execution);
    fixture.componentRef.setInput('label', 'Copy link to this run');
    fixture.detectChanges();
    expect(button(fixture).textContent).toContain('Copy link to this run');
    button(fixture).click();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.querySelector('input')).not.toBeNull(),
    );
    const input = fixture.nativeElement.querySelector(
      'input',
    ) as HTMLInputElement;
    expect(input.value).toBe(evidenceLinkUrl(location.origin, ref, execution));
    const select = vi.spyOn(input, 'select');
    input.dispatchEvent(new Event('focus'));
    expect(select).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'select the link below',
    );
  });

  it('ignores a clipboard answer that arrives after the run changed', async () => {
    let finish!: (ok: boolean) => void;
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: () =>
          new Promise<void>((resolve, reject) => {
            finish = (ok) => (ok ? resolve() : reject(new Error('denied')));
          }),
      },
    });
    const fixture = await render(execution);
    button(fixture).click();
    fixture.componentRef.setInput('target', checkRun.target);
    fixture.detectChanges();
    finish(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Link copied.');
    button(fixture).click();
    fixture.componentRef.setInput('target', execution.target);
    fixture.detectChanges();
    finish(false);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });

  it('renders nothing for evidence that cannot be linked', async () => {
    expect(button(await render(undefined))).toBeNull();
    TestBed.resetTestingModule();
    expect(
      button(
        await render(execution, {
          storeId: 'github',
          projectId: 'p1',
        } as never),
      ),
    ).toBeNull();
  });
});
