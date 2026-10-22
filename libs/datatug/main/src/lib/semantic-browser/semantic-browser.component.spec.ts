import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SemanticBrowserModel } from './semantic-browser-model';
import { SemanticBrowserComponent } from './semantic-browser.component';

// Presentation fixtures only: no source protocol, authority, API or provider claim.
describe('semantic browser with independent neutral source models', () => {
  it.each([
    ['Telemetry samples', 'sensor-feed', 'temperature', '21.5'],
    ['Archive entries', 'archive-index', 'document_name', 'Quarterly report'],
  ])(
    'renders %s without source interpretation and delegates the exact selected cell',
    async (title, sourceId, column, value) => {
      const selectCell = vi.fn().mockResolvedValue(undefined),
        busy = signal(false);
      const model: SemanticBrowserModel = {
        sourceId,
        labels: {
          title,
          rowsDescription: 'selected sample',
          emptyRowsMessage: 'No samples.',
          relatedDescription: 'same sample',
        },
        refreshIcon: '',
        findChecksIcon: '',
        checkLabels: {},
        environments: signal(['lab']),
        canWrite: signal(false),
        environment: signal(''),
        selection: signal(undefined),
        schema: signal(undefined),
        collection: signal('samples'),
        rows: signal({
          schemaToken: 'observed',
          collection: 'samples',
          columns: [{ name: column, type: 'TEXT', nullable: false }],
          rows: [{ rowToken: 'row-7', cells: [{ type: 'string', value }] }],
          truncated: false,
        }),
        selected: signal(undefined),
        resolution: signal(undefined),
        related: signal(undefined),
        relatedRows: signal(undefined),
        entity: signal(undefined),
        entities: signal([]),
        fieldId: signal(''),
        picker: signal(false),
        busy,
        workStatus: signal(''),
        selectedValue: signal(undefined),
        error: signal(''),
        notice: signal(''),
        pending: signal(undefined),
        blocked: signal(false),
        restoring: signal(false),
        reviewed: signal(false),
        conflict: signal(false),
        caseId: signal(undefined),
        mappingChoiceAvailable: signal(false),
        saveAllowed: signal(false),
        checksPending: signal(false),
        checksError: signal(''),
        applicable: signal(undefined),
        changeEnvironment: vi.fn(),
        chooseContext: vi.fn(),
        inspect: vi.fn(),
        refresh: vi.fn(),
        selectCell,
        retryResolution: vi.fn(),
        checkHref: vi.fn(),
        findChecks: vi.fn(),
        openRelated: vi.fn(),
        openPicker: vi.fn(),
        chooseEntity: vi.fn(),
        cancel: vi.fn(),
        save: vi.fn(),
        retry: vi.fn(),
        reviewPending: vi.fn(),
        abandon: vi.fn(),
        cellText: () => value,
      };
      TestBed.configureTestingModule({
        imports: [SemanticBrowserComponent],
        providers: [provideRouter([])],
      });
      const fixture = TestBed.createComponent(SemanticBrowserComponent);
      fixture.componentRef.setInput('model', model);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(title);
      expect(fixture.nativeElement.textContent).toContain(column);
      expect(fixture.nativeElement.textContent).toContain(value);
      const cell = fixture.nativeElement.querySelector(
        'td button',
      ) as HTMLButtonElement;
      expect(cell.getAttribute('aria-label')).toBe(`${column}: ${value}`);
      cell.click();
      expect(selectCell).toHaveBeenCalledWith(0, 0, expect.any(Event));
      busy.set(true);
      fixture.detectChanges();
      expect(cell.disabled).toBe(true);
      expect(fixture.nativeElement.querySelector('ion-card')).toBeNull();
    },
  );
});
