import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenVaultDBAgentService } from './openvaultdb-agent.service';
import { AuthorizationResult } from './openvaultdb.models';
import { OpenVaultDBPageComponent } from './openvaultdb-page.component';

const result = (
  outcome: AuthorizationResult['result'],
  disclosure: 'full' | 'redacted' = 'full',
): AuthorizationResult => ({
  apiVersion: 'dtql.org/authorization/v1',
  requestId: 'r1',
  mode: 'plan',
  scope: 'request',
  result: outcome,
  allowed: outcome === 'allow',
  hypothetical: false,
  operations: [],
  layers: [
    {
      layerId: 'outer',
      source: {
        ownerId: 'owner-public',
        provider: 'openvaultdb',
        databaseId: 'crm',
        kind: 'vault',
        reference: disclosure === 'full' ? 'public-policy-ref' : undefined,
      },
      aclState: 'enabled',
      result: outcome,
      decisions: [],
    },
  ],
  blockers:
    outcome === 'deny'
      ? [{ operationId: 'q1', code: 'ACL_RULE_DENIED', scope: 'operation' }]
      : [],
  coverage: {
    evaluation: outcome === 'indeterminate' ? 'partial' : 'complete',
    disclosure,
    truncated: false,
    unevaluated: [],
  },
  restrictions:
    outcome === 'conditional'
      ? [
          {
            id: 'opaque',
            operationId: 'q1',
            representation: 'reference',
            kind: 'row_filter',
            enforced: false,
            omissionReason: 'not_authorized',
          },
        ]
      : [],
});

describe('OpenVaultDBPageComponent', () => {
  let api: {
    targets: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    explain: ReturnType<typeof vi.fn>;
    evidence: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    api = {
      targets: vi.fn(() => of({ targets: [] })),
      query: vi.fn(),
      explain: vi.fn(),
      evidence: vi.fn(),
      update: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [OpenVaultDBPageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ agentId: 'localhost:8989' }),
            },
          },
        },
        {
          provide: OpenVaultDBAgentService,
          useValue: api,
        },
      ],
    }).compileComponents();
  });

  for (const outcome of [
    'allow',
    'conditional',
    'deny',
    'indeterminate',
  ] as const) {
    it(`renders the ${outcome} outcome`, async () => {
      const fixture = TestBed.createComponent(OpenVaultDBPageComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.componentInstance.authorization.set(result(outcome));
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(`Access: ${outcome}`);
    });
  }

  it('renders redacted structural limits without policy text', async () => {
    const fixture = TestBed.createComponent(OpenVaultDBPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.authorization.set(
      result('conditional', 'redacted'),
    );
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('limited details');
    expect(text).toContain('details unavailable');
    expect(text).not.toContain('public-policy-ref');
    expect(text).not.toContain('policy editor');
  });

  it('shows a public reference only when the response supplies it', async () => {
    const fixture = TestBed.createComponent(OpenVaultDBPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.authorization.set(result('allow', 'full'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('public-policy-ref');
  });

  it('does not update when the selected row cannot be refreshed', async () => {
    api.evidence.mockReturnValue(
      throwError(() => new Error('read unavailable')),
    );
    const fixture = TestBed.createComponent(OpenVaultDBPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.targets.set([{ id: 'crm-target', databaseId: 'crm' }]);
    component.targetId.set('crm-target');
    component.selected.set({ key: '101', data: { name: 'Ada' } });
    component.recordsTargetId.set('crm-target');
    component.recordsTable.set('customers');
    component.updateValue.set('Grace');
    await component.updateSelected();
    expect(api.update).not.toHaveBeenCalled();
    expect(component.error()).toContain('Run the query again');
  });

  it('uses the freshly read revision for a selected-row update', async () => {
    api.evidence.mockReturnValue(of({ dataRevision: 'whole-row-r7' }));
    api.update.mockReturnValue(
      of({ authorization: result('allow'), dataRevision: 'whole-row-r8' }),
    );
    const fixture = TestBed.createComponent(OpenVaultDBPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.targets.set([{ id: 'crm-target', databaseId: 'crm' }]);
    component.targetId.set('crm-target');
    component.selected.set({ key: '101', data: { name: 'Ada' } });
    component.recordsTargetId.set('crm-target');
    component.recordsTable.set('customers');
    component.updateValue.set('Grace');
    await component.updateSelected();
    expect(api.update).toHaveBeenCalledOnce();
    expect(api.update).toHaveBeenCalledWith(
      'localhost:8989',
      'crm-target',
      expect.objectContaining({
        mutation: expect.objectContaining({
          ifDataRevision: 'whole-row-r7',
        }),
      }),
    );
  });

  it('clears records and selection when the target changes', async () => {
    const fixture = TestBed.createComponent(OpenVaultDBPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.targets.set([
      { id: 'first', databaseId: 'crm-a' },
      { id: 'second', databaseId: 'crm-b' },
    ]);
    component.targetId.set('first');
    const record = { key: 'customers/101', data: { name: 'Ada' } };
    component.records.set([record]);
    component.recordsTargetId.set('first');
    component.recordsTable.set('customers');
    component.select(record);
    component.authorization.set(result('allow'));

    component.changeTarget('second');

    expect(component.records()).toEqual([]);
    expect(component.selected()).toBeUndefined();
    expect(component.authorization()).toBeUndefined();
  });

  it('ignores a query response after its target changes', async () => {
    const response = new Subject<{ records: readonly [] }>();
    api.query.mockReturnValue(response);
    const fixture = TestBed.createComponent(OpenVaultDBPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.targets.set([
      { id: 'first', databaseId: 'crm-a' },
      { id: 'second', databaseId: 'crm-b' },
    ]);
    component.targetId.set('first');
    const pending = component.runQuery();
    component.changeTarget('second');
    response.next({ records: [] });
    response.complete();
    await pending;

    expect(component.recordsTargetId()).toBe('');
  });

  it('replaces a prior allow with authorization from a failed request', async () => {
    const denial = result('deny');
    api.explain.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { authorization: denial, error: { message: 'Access denied' } },
          }),
      ),
    );
    const fixture = TestBed.createComponent(OpenVaultDBPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.targets.set([{ id: 'crm-target', databaseId: 'crm' }]);
    component.targetId.set('crm-target');
    component.authorization.set(result('allow'));

    await component.explain('plan');

    expect(component.authorization()?.result).toBe('deny');
    expect(component.error()).toBe('Access denied');
  });
});
