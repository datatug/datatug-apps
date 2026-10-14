import { TestBed } from '@angular/core/testing';
import { PublicSqliteComparisonPanelComponent } from './public-sqlite-comparison-panel.component';
import {
  PUBLIC_CHINOOK_COMPARISON_TARGETS,
  type ComparisonSessionSnapshot,
  type SessionCompareResult,
} from '../../public-sqlite-comparison';

describe('PublicSqliteComparisonPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicSqliteComparisonPanelComponent],
    }).compileComponents();
  });

  it('keeps Run Both blocked until the current bounded preview is eligible', () => {
    const fixture = TestBed.createComponent(PublicSqliteComparisonPanelComponent);
    fixture.componentRef.setInput('blockedReason', 'Preview the supported Invoice query first.');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[data-testid="comparison-run-both"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Preview the supported Invoice query first.');
  });

  it('renders distinct side identities, receipts, and safe one-sided result labels', () => {
    const fixture = TestBed.createComponent(PublicSqliteComparisonPanelComponent);
    const snapshot: ComparisonSessionSnapshot = {
      generation: 1,
      context: {
        projectRef: '{project}', pageMemoryScope: 'public-github:{project}',
        accessClassification: 'public', agentSecurityContextId: 'sctx-1', accessGeneration: 0,
        draftRevision: 2, authoredSourceFingerprint: 'source-fingerprint',
        relationshipFingerprint: 'relationship-fingerprint', typedBindingsFingerprint: 'binding-fingerprint',
      },
      invalidated: false,
      sides: PUBLIC_CHINOOK_COMPARISON_TARGETS.map((target, index) => ({
        target, status: 'complete' as const, attempt: 1,
        observation: {
          kind: 'browser-session' as const, targetId: target.id,
          fixtureSha256: target.sha256, schemaSha256: target.schemaSha256,
          schemaFingerprint: 'runtime-schema', columns: [
            { name: 'InvoiceId', type: 'integer' as const },
            { name: 'InvoiceDate', type: 'string' as const },
          ], executionId: `execution-${index}`, observedAt: '2026-10-11T10:00:00.000Z',
          rowCount: 1, rows: [[10, '2009-01-01']], resultComplete: true as const,
          projectRef: '{project}', pageMemoryScope: 'public-github:{project}',
          accessClassification: 'public', agentSecurityContextId: 'sctx-1', accessGeneration: 0,
          sessionGeneration: 1,
          draftRevision: 2, authoredSourceFingerprint: 'source-fingerprint',
          relationshipFingerprint: 'relationship-fingerprint', typedBindingsFingerprint: 'binding-fingerprint',
          limitations: [], expiresWithSession: true as const,
        },
      })),
    };
    const result: SessionCompareResult = {
      kind: 'session-comparison', abi: 'recordsetcompare/1',
      label: 'Session comparison · expires when this page closes or refreshes',
      observedAt: '2026-10-11T10:00:01.000Z', expiresWithSession: true,
      diff: {
        columns: [{ name: 'InvoiceId', type: 'integer' }, { name: 'InvoiceDate', type: 'string' }],
        key: ['InvoiceId'],
        added: [{ key: [{ type: 'integer', value: '11' }], row: [{ type: 'integer', value: '11' }, { type: 'string', value: '2009-02-01' }] }],
        removed: [{ key: [{ type: 'integer', value: '9' }], row: [{ type: 'integer', value: '9' }, { type: 'string', value: '2008-12-01' }] }],
        changed: [{
          key: [{ type: 'integer', value: '10' }],
          columns: [{ column: 'InvoiceDate', left: { type: 'string', value: '2009-01-01' }, right: { type: 'string', value: '2009-01-02' } }],
        }],
        summary: { added: 1, removed: 1, changed: 1, unchanged: 0, columnsOnlyOnOneSide: [] },
        policyLimited: false, truncated: false,
      },
    };
    fixture.componentRef.setInput('snapshot', snapshot);
    fixture.componentRef.setInput('result', result);
    fixture.componentRef.setInput('blockedReason', 'Ready · Preview is current.');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="comparison-side-baseline"]')).toBeTruthy();
    expect(element.querySelector('[data-testid="comparison-side-candidate"]')).toBeTruthy();
    expect(element.textContent).toContain('Pinned upstream baseline');
    expect(element.textContent).toContain('Synthetic comparison fixture (not production data)');
    expect(element.textContent).toContain('Changed · InvoiceId 10');
    expect(element.textContent).toContain('2009-01-01 → 2009-01-02');
    expect(element.textContent).toContain('Baseline-only · InvoiceId 9');
    expect(element.textContent).toContain('Candidate-only · InvoiceId 11');
    expect(element.textContent).toContain('not durable or citable evidence');
    expect(element.textContent).toContain('do not establish a database deletion or cause');
  });
});
