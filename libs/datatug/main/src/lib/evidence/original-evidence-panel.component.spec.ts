import { TestBed } from '@angular/core/testing';
import { OriginalEvidencePanelComponent } from './original-evidence-panel.component';
import { sourceEvidencePresenter } from './source-evidence-presentation';
import type {
  OriginalEvidencePresentation,
  SourceEvidencePresenter,
} from './source-evidence-presentation';

describe('neutral original evidence projection', () => {
  it.each([
    ['Calibration observation', 'sample', '2026-10-21T09:00:00Z'],
    ['Document revision', 'document', 'Revision seven'],
  ])(
    'renders %s with exact bytes/provenance and no collection-name inference',
    (summary, collection, value) => {
      const data: OriginalEvidencePresentation = {
        status: 'available',
        summary,
        records: [
          {
            title: collection,
            facts: [{ label: 'valid_from', value }],
            fields: [
              { label: 'valid_from', value },
              { label: 'owner', value: 'original-owner' },
            ],
          },
        ],
        log: {
          artifact: 'records.log',
          byteStart: 3,
          byteEnd: 8,
          artifactBytes: 20,
          parser: 'text',
          parseStatus: 'observed',
          artifactSHA256: 'a'.repeat(64),
          sourceRef: 'retained-source',
          text: 'line\n',
          rawBase64: 'bGluZQo=',
        },
      };
      const fixture = TestBed.createComponent(OriginalEvidencePanelComponent);
      fixture.componentRef.setInput('presentation', data);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(summary);
      expect(fixture.nativeElement.textContent).toContain('original-owner');
      expect(fixture.nativeElement.textContent).toContain('bytes [3, 8) of 20');
      expect(
        fixture.nativeElement.querySelector(
          'pre[aria-label="Original log text"]',
        ).textContent,
      ).toBe('line\n');
      expect(fixture.nativeElement.textContent).toContain('bGluZQo=');
      expect(
        fixture.nativeElement.querySelector('.observation-bound'),
      ).toBeNull();
      fixture.componentRef.setInput('presentation', {
        status: 'unavailable',
        reason: 'Current access denied',
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'Current access denied',
      );
      expect(fixture.nativeElement.textContent).not.toContain('original-owner');
      expect(fixture.nativeElement.querySelector('pre')).toBeNull();
    },
  );
  it('shows record-only admitted evidence as available without fabricating log provenance', () => {
    const fixture = TestBed.createComponent(OriginalEvidencePanelComponent);
    fixture.componentRef.setInput('presentation', {
      status: 'available',
      records: [
        {
          title: 'Calibration sample',
          facts: [{ label: 'Measured value', value: '21.5' }],
          fields: [{ label: 'Measured value', value: '21.5' }],
        },
      ],
    } satisfies OriginalEvidencePresentation);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('header').textContent).toContain(
      'Available',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Unavailable');
    expect(fixture.nativeElement.textContent).toContain('Calibration sample');
    expect(fixture.nativeElement.textContent).toContain('21.5');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Original log bytes',
    );
    expect(fixture.nativeElement.querySelector('pre')).toBeNull();
  });
  it('requires exactly one source projector, without granting a source from a reference alone', () => {
    const presenter: SourceEvidencePresenter = {
      sourceId: 'independent-source',
      operation: vi.fn(),
      original: vi.fn(),
    };
    expect(sourceEvidencePresenter([], presenter.sourceId)).toBeUndefined();
    expect(
      sourceEvidencePresenter([presenter], 'other-source'),
    ).toBeUndefined();
    expect(
      sourceEvidencePresenter([presenter, presenter], presenter.sourceId),
    ).toBeUndefined();
    expect(sourceEvidencePresenter([presenter], presenter.sourceId)).toBe(
      presenter,
    );
  });
});
