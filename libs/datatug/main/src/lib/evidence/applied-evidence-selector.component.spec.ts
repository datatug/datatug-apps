import { NativeSourceInvalidationService } from './native-source-invalidation';
import { By } from '@angular/platform-browser';
import { IonSelect } from '@ionic/angular';
import { TestBed } from '@angular/core/testing';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of } from 'rxjs';
import { AppliedEvidenceSelectorComponent } from './applied-evidence-selector.component';
import { SessionContextApiService } from '../session-context/session-context-api.service';
import { RetainedEvidenceApiService } from './retained-evidence-api.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { AgentContextService } from '@sneat/datatug-semantic';
import {
  appliedCapabilities,
  appliedSnapshot,
  scope,
  subject,
} from './applied-context.spec-helper';
const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'project' };
describe('Explicit current applied context DOM selection', () => {
  it.each(['actor', 'source-reset', 'source-replacement', 'inspect'] as const)(
    'selects an actual applied revision before any Case, then clears matching %s without hidden writes',
    async (change) => {
      const snapshot = appliedSnapshot(),
        auth = new BehaviorSubject({
          status: 'authenticated',
          user: { uid: 'sarah' },
        });
      const api = {
        capabilities: vi.fn(async () => appliedCapabilities),
        list: vi.fn(async () => ({
          items: [snapshot.session],
          hasMore: false,
        })),
        read: vi.fn(async () => snapshot),
        command: vi.fn(),
      };
      await TestBed.configureTestingModule({
        imports: [AppliedEvidenceSelectorComponent],
        providers: [
          { provide: SessionContextApiService, useValue: api },
          {
            provide: RetainedEvidenceApiService,
            useValue: { contextScope: vi.fn(async () => ({ scope, subject })) },
          },
          { provide: SneatAuthStateService, useValue: { authState: auth } },
          {
            provide: DatatugNavContextService,
            useValue: {
              currentProject: new BehaviorSubject({ ref }),
              currentEnv: of(undefined),
            },
          },
          {
            provide: AgentContextService,
            useValue: { securityContextId: () => undefined },
          },
        ],
      }).compileComponents();
      const page = TestBed.createComponent(AppliedEvidenceSelectorComponent),
        values: unknown[] = [];
      page.componentInstance.selected.subscribe((value) => values.push(value));
      if (change === 'inspect') page.componentRef.setInput('mode', 'inspect');
      page.componentRef.setInput('projectRef', ref);
      page.componentRef.setInput('actor', 'sarah');
      page.componentRef.setInput('environment', 'demo');
      page.componentRef.setInput('incidentRef', 'incidents/INC-1');
      page.detectChanges();
      await page.whenStable();
      if (change === 'inspect') {
        expect(page.nativeElement.textContent).toContain(
          'Inspection does not Apply',
        );
        expect(page.nativeElement.textContent).not.toContain(
          'Sharing attaches',
        );
      } else
        expect(page.nativeElement.textContent).toContain('Sharing attaches');
      const load = page.nativeElement.querySelector('ion-button');
      load.click();
      await vi.waitFor(() => expect(api.list).toHaveBeenCalledOnce());
      await page.whenStable();
      const session = page.debugElement.queryAll(By.directive(IonSelect))[0]
        .nativeElement;
      expect(session).not.toBeNull();
      session.dispatchEvent(
        new CustomEvent('ionChange', { detail: { value: 'session' } }),
      );
      await vi.waitFor(() => expect(api.read).toHaveBeenCalledOnce());
      await page.whenStable();
      const revision = page.debugElement.queryAll(By.directive(IonSelect))[1]
        .nativeElement;
      revision.dispatchEvent(
        new CustomEvent('ionChange', { detail: { value: '0' } }),
      );
      expect(values.at(-1)).toMatchObject({
        evidence: {
          incidentRef: 'incidents/INC-1',
          context: {
            sessionId: 'session',
            bindings: [
              {
                inputName: 'order_id',
                entryId: 'entry',
                revisionId: 'applied',
              },
            ],
          },
        },
      });
      expect(api.command).not.toHaveBeenCalled();
      if (change === 'actor')
        auth.next({ status: 'authenticated', user: { uid: 'maya' } });
      else if (change === 'source-replacement') {
        page.componentRef.setInput('sourceId', 'independent-source');
        page.detectChanges();
        await page.whenStable();
      } else
        TestBed.inject(NativeSourceInvalidationService).invalidate({
          projectRef: ref,
          actor: 'sarah',
          sourceId: 'shipping-working-copy',
          action: 'reset',
        });
      expect(values.at(-1)).toBeUndefined();
      page.destroy();
    },
  );
});
