import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { SessionDetectiveRunComponent } from './session-detective-run.component';
import { SessionWorkspaceService } from './session-workspace.service';
import { SessionContextApiService } from './session-context-api.service';
import { NATIVE_OPERATION_STORE } from './session-detective-operation.service';
import {
  ContextCapabilities,
  ContextSnapshot,
  contextScopeKey,
} from './session-context-contract';
const scope = { environmentId: 'demo', identityDomain: 'embedded-domain' };
const other = { environmentId: 'demo', identityDomain: 'chinook-domain' };
const project = { storeId: 'http-localhost:8989', projectId: 'source-project' };
const operationScope = {
  storage: 'local',
  project: 'source-project',
  databaseId: 'ops',
  projectId: 'private-project',
  namespaceId: 'private-ns',
};
const caps: ContextCapabilities = {
  schemaVersion: 1,
  actorId: 'alice',
  databaseId: 'ops',
  projectId: 'private-project',
  nativeDetective: true,
  operationScope,
  environments: [other, scope],
  actions: [],
};
function snapshot(): ContextSnapshot {
  return {
    session: {
      schemaVersion: 1,
      id: 's1',
      owner: 'alice',
      databaseId: 'ops',
      projectId: 'private-project',
      title: 'Investigation',
      state: 'active',
      version: 7,
      defaultBagId: 'b1',
      bagIds: ['b1', 'b2'],
      contextSetId: 'cs1',
      createdAt: '',
      updatedAt: '',
    },
    bags: [scope, other].map((scope, index) => ({
      id: `b${index + 1}`,
      sessionId: 's1',
      title: 'Invoices',
      scope,
      version: 1,
      entryIds: [`e${index + 1}`],
    })),
    entries: [1, 2].map((index) => ({
      id: `e${index}`,
      sessionId: 's1',
      bagId: `b${index}`,
      alias: `Invoice ${index}`,
      subject: {
        conceptId: 'invoice',
        fieldId: 'invoice_id',
        fieldMappingRef: `source-${index}`,
      },
      currentRevisionId: `r${index}`,
      version: 1,
    })),
    revisions: [1, 2].map((index) => ({
      id: `r${index}`,
      entryId: `e${index}`,
      bagId: `b${index}`,
      subject: {
        conceptId: 'invoice',
        fieldId: 'invoice_id',
        fieldMappingRef: `source-${index}`,
      },
      value: {
        schemaVersion: 1,
        kind: 'scalar',
        scalar: { type: 'integer', value: `${index}` },
      },
      createdAt: '',
    })),
    contextSet: {
      id: 'cs1',
      sessionId: 's1',
      enabled: true,
      createdAt: '',
      slots: [scope, other].map((scope, index) => ({
        scope,
        bagId: `b${index + 1}`,
        bagVersion: 1,
        version: 1,
        entries: [{ entryId: `e${index + 1}`, revisionId: `r${index + 1}` }],
      })),
    },
  };
}
describe('native Check input preview', () => {
  it('does not select a first domain and sends only explicit exact revision mappings', async () => {
    const current = signal(snapshot());
    const nativeDetective = vi.fn(async (_project, _caps, request) => ({
      operationId: request.operationId,
      operationScope,
      status: {
        runId: 'run_1',
        state: 'completed',
        produced: true,
        done: true,
      },
    }));
    TestBed.configureTestingModule({
      imports: [SessionDetectiveRunComponent],
      providers: [
        provideRouter([]),
        {
          provide: SessionWorkspaceService,
          useValue: {
            capabilities: signal(caps),
            snapshotFor: () => current(),
            draft: () => ({ attachments: [] }),
            canExecuteFor: () => true,
          },
        },
        { provide: SessionContextApiService, useValue: { nativeDetective } },
        {
          provide: NATIVE_OPERATION_STORE,
          useValue: {
            read: async () => undefined,
            write: async () => undefined,
            remove: async () => undefined,
            readRecovery: async () => undefined,
            writeRecovery: async () => undefined,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(SessionDetectiveRunComponent);
    fixture.componentRef.setInput('check', {
      id: 'invoice-check',
      title: 'Invoice check',
      version: 2,
      inputs: [
        {
          name: 'invoice_id',
          type: 'integer',
          cardinality: 'scalar',
          required: true,
        },
      ],
      steps: [],
    });
    fixture.componentRef.setInput('project', project);
    fixture.componentRef.setInput('sessionId', 's1');
    fixture.componentRef.setInput('environment', 'demo');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(nativeDetective).not.toHaveBeenCalled();
    const select = fixture.debugElement.query(
      By.css('ion-select[aria-label="Source identity domain"]'),
    );
    select.nativeElement.value = contextScopeKey(scope);
    select.nativeElement.dispatchEvent(
      new CustomEvent('ionChange', {
        detail: { value: contextScopeKey(scope) },
        bubbles: true,
      }),
    );
    fixture.detectChanges();
    const binding = fixture.debugElement.query(
      By.css('ion-select[aria-label="Context binding invoice_id"]'),
    );
    expect(binding.nativeElement.textContent).toContain('Invoice 1');
    expect(binding.nativeElement.textContent).not.toContain('Invoice 2');
    binding.nativeElement.value = 'manual';
    binding.nativeElement.dispatchEvent(
      new CustomEvent('ionChange', {
        detail: { value: 'manual' },
        bubbles: true,
      }),
    );
    fixture.detectChanges();
    const manual = fixture.debugElement.query(By.css('ion-input'));
    manual.nativeElement.value = '19';
    manual.nativeElement.dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: '19' }, bubbles: true }),
    );
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'manual integer · scalar · required: 19',
    );
    manual.nativeElement.value = '23';
    manual.nativeElement.dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: '23' }, bubbles: true }),
    );
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'manual integer · scalar · required: 23',
    );
    binding.nativeElement.value = 'r1';
    binding.nativeElement.dispatchEvent(
      new CustomEvent('ionChange', { detail: { value: 'r1' }, bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'invoice_id ← Invoice 1',
    );
    const button = fixture.debugElement
      .queryAll(By.css('ion-button'))
      .find((button) =>
        button.nativeElement.textContent.includes('Run native Check'),
      );
    if (!button) throw new Error('Native run button missing.');
    button.triggerEventHandler('click');
    await fixture.whenStable();
    expect(nativeDetective).toHaveBeenCalledTimes(1);
    const body = nativeDetective.mock.calls[0][2];
    expect(body.scope).toEqual(scope);
    expect(body.bindings).toEqual([
      { inputName: 'invoice_id', entryId: 'e1', revisionId: 'r1' },
    ]);
    expect(body).not.toHaveProperty('runId');
    expect(body).not.toHaveProperty('inputSnapshotId');
    expect(body).not.toHaveProperty('inputs');
    expect(body.bindings[0]).not.toHaveProperty('origin');
  });
});
