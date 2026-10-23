import { USAGE_ANALYTICS_SINK } from '../analytics/usage-analytics';
import { TestBed } from '@angular/core/testing';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject } from 'rxjs';
import { shippingEvidencePresenter } from '../shipping/shipping-evidence-presenter';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { RetainedEvidenceApiService } from './retained-evidence-api.service';
import { RetainedEvidenceViewerComponent } from './retained-evidence-viewer.component';
import {
  readRetainedCheck,
  readRetainedExecution,
} from './retained-open-contract';
import { readSourceOperation } from './source-operation-contract';
import { SOURCE_EVIDENCE_PRESENTERS } from './source-evidence-presentation';
import { parseEvidenceFragment } from './evidence-link';
import fixture from './testdata/backend-v044-retained.json';
import sourceFixture from './testdata/source-operation.facade.go.json';

const usageSent: [string, unknown][] = [];
beforeEach(() => void (usageSent.length = 0));
const ref = {
  storeId: 'firestore',
  spaceID: 'fixture-space',
  projectId: 'fixture-project',
};
const scope = {
  projectRef: ref,
  environment: 'demo',
  actor: 'current-reader',
  nativeDatabaseId: 'fixture-db',
  nativeProjectId: 'fixture-project',
};
const checkRunRef = {
  storeId: 'firestore',
  projectId: 'fixture-project',
  environment: 'demo',
  checkId: 'request-received',
  checkVersion: 1,
  runId: 'fixture-run',
};

async function render(
  inputs: Record<string, unknown>,
  read: () => Promise<unknown>,
  openRow: () => Promise<unknown> = () => Promise.reject(new Error('unused')),
  project: Record<string, string> = ref,
  actor = 'current-reader',
) {
  TestBed.configureTestingModule({
    imports: [RetainedEvidenceViewerComponent],
    providers: [
      {
        provide: USAGE_ANALYTICS_SINK,
        useValue: {
          send: (name: string, params: unknown) =>
            usageSent.push([name, params]),
        },
      },
      {
        provide: SOURCE_EVIDENCE_PRESENTERS,
        useValue: [shippingEvidencePresenter],
      },
      {
        provide: SneatAuthStateService,
        useValue: {
          authState: new BehaviorSubject({
            status: 'authenticated',
            user: { uid: actor },
          }),
        },
      },
      {
        provide: DatatugNavContextService,
        useValue: { currentProject: new BehaviorSubject({ ref: project }) },
      },
      { provide: RetainedEvidenceApiService, useValue: { read, openRow } },
    ],
  });
  const page = TestBed.createComponent(RetainedEvidenceViewerComponent);
  page.componentRef.setInput('projectRef', project);
  page.componentRef.setInput('environment', 'demo');
  for (const [key, value] of Object.entries(inputs))
    page.componentRef.setInput(key, value);
  page.detectChanges();
  await page.whenStable();
  return page;
}

function copiedLink(page: { nativeElement: HTMLElement }) {
  return page.nativeElement.querySelector(
    'sneat-datatug-evidence-copy-link',
  ) as HTMLElement;
}

describe('Copy link on retained evidence', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('links a loaded retained execution', async () => {
    const value = await readRetainedExecution(
      fixture.execution,
      scope,
      fixture.execution.result.execution,
    );
    const page = await render(
      {
        target: {
          kind: 'execution',
          execution: fixture.execution.result.execution,
        },
      },
      async () => value,
    );
    await vi.waitFor(() => expect(copiedLink(page)).not.toBeNull());
    expect(copiedLink(page).textContent).toContain('Copy link');
  });

  it('links a loaded retained Check run', async () => {
    const value = await readRetainedCheck(fixture.check, scope, checkRunRef);
    const page = await render(
      { target: { kind: 'check-run', checkRun: checkRunRef } },
      async () => value,
    );
    await vi.waitFor(() => expect(copiedLink(page)).not.toBeNull());
  });

  it('links a selected row to its run, without the row key or fingerprint', async () => {
    const value = await readRetainedExecution(
      fixture.execution,
      scope,
      fixture.execution.result.execution,
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const page = await render(
      { selector: fixture.selector, heldResult: fixture.execution.result },
      () => Promise.reject(new Error('unused')),
      async () => value,
    );
    await vi.waitFor(() => expect(copiedLink(page)).not.toBeNull());
    const button = copiedLink(page).querySelector('ion-button') as HTMLElement;
    expect(button.textContent).toContain('Copy link to this run');
    button.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    // Only the kind of link and demo/other are recorded, never the run.
    expect(usageSent).toEqual([
      ['evidence_link_copied', { kind: 'execution', project: 'other' }],
    ]);
    const url = writeText.mock.calls[0][0] as string;
    expect(url).not.toContain('fixture-row');
    expect(parseEvidenceFragment(url.split('#')[1], ref)?.target).toEqual({
      kind: 'execution',
      execution: fixture.execution.result.execution,
    });
    expect(
      atob(url.split('evidence=')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ).not.toContain(fixture.selector.recordsetFingerprint);
    vi.unstubAllGlobals();
  });

  it('offers no link for a source receipt, before loading, or after an error', async () => {
    const sourceRef = {
      storeId: 'firestore',
      spaceID: sourceFixture.request.spaceID,
      projectId: sourceFixture.request.projectId,
    };
    const actor = sourceFixture.request.reference.receiptActorId;
    const value = readSourceOperation(
      sourceFixture.open,
      { projectRef: sourceRef, environment: 'demo', actor },
      sourceFixture.request.reference,
    );
    const receipt = await render(
      {
        target: {
          kind: 'source-operation',
          sourceOperation: sourceFixture.request.reference,
        },
      },
      async () => value,
      undefined,
      sourceRef,
      actor,
    );
    await vi.waitFor(() =>
      expect(receipt.nativeElement.textContent).toContain('Source operation'),
    );
    expect(copiedLink(receipt)).toBeNull();
    TestBed.resetTestingModule();
    const failed = await render(
      {
        target: {
          kind: 'execution',
          execution: fixture.execution.result.execution,
        },
      },
      () => Promise.reject({ status: 403 }),
    );
    await vi.waitFor(() =>
      expect(failed.nativeElement.textContent).toContain(
        'no longer available to this account',
      ),
    );
    expect(copiedLink(failed)).toBeNull();
  });
});
