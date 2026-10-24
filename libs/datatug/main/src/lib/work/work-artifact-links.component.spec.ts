import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { WorkApiService } from './work-api.service';
import { WorkArtifactLinksComponent } from './work-artifact-links.component';
import { workDetailFixture } from './work.spec-helper';

describe('WorkArtifactLinksComponent', () => {
  it('loads exact folder identity and clears authorized titles synchronously when identity changes', async () => {
    const auth = new BehaviorSubject({ user: { uid: 'lead' } });
    const api = {
      artifactLinks: vi
        .fn()
        .mockResolvedValue({ items: [workDetailFixture().item], links: [] }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        { provide: WorkApiService, useValue: api },
      ],
    });
    const f = TestBed.createComponent(WorkArtifactLinksComponent);
    f.componentRef.setInput('project', {
      storeId: 'firestore',
      spaceID: 'space',
      projectId: 'project',
    });
    f.componentRef.setInput('kind', 'query');
    f.componentRef.setInput('identifier', 'shipping/order-receipt');
    f.detectChanges();
    await f.whenStable();
    expect(api.artifactLinks).toHaveBeenCalledWith(
      { spaceID: 'space', projectID: 'project' },
      'query',
      'order-receipt',
      'shipping',
      expect.any(AbortSignal),
      '',
    );
    expect(f.componentInstance.items()).toHaveLength(1);
    auth.next({ user: { uid: '' } });
    expect(f.componentInstance.items()).toEqual([]);
  });
  it('does not request hosted references for local artefacts', async () => {
    const api = { artifactLinks: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject({ user: { uid: 'lead' } }),
          },
        },
        { provide: WorkApiService, useValue: api },
      ],
    });
    const f = TestBed.createComponent(WorkArtifactLinksComponent);
    f.componentRef.setInput('project', {
      storeId: 'localhost:8989',
      projectId: 'northwind',
    });
    f.componentRef.setInput('kind', 'check');
    f.componentRef.setInput('identifier', 'check1');
    f.detectChanges();
    await f.whenStable();
    expect(api.artifactLinks).not.toHaveBeenCalled();
  });
  it('requires an exact Watch environment and clears old titles when it changes', async () => {
    const api = {
      artifactLinks: vi
        .fn()
        .mockResolvedValue({ items: [workDetailFixture().item], links: [] }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject({ user: { uid: 'lead' } }),
          },
        },
        { provide: WorkApiService, useValue: api },
      ],
    });
    const f = TestBed.createComponent(WorkArtifactLinksComponent);
    f.componentRef.setInput('project', {
      storeId: 'firestore',
      spaceID: 'space',
      projectId: 'project',
    });
    f.componentRef.setInput('kind', 'watch');
    f.componentRef.setInput('identifier', 'watch1');
    f.detectChanges();
    await f.whenStable();
    expect(api.artifactLinks).not.toHaveBeenCalled();
    f.componentRef.setInput('environment', 'uat');
    f.detectChanges();
    await f.whenStable();
    expect(api.artifactLinks).toHaveBeenLastCalledWith(
      { spaceID: 'space', projectID: 'project' },
      'watch',
      'watch1',
      '',
      expect.any(AbortSignal),
      'uat',
    );
    f.componentRef.setInput('environment', 'prod');
    f.detectChanges();
    expect(f.componentInstance.items()).toEqual([]);
    await f.whenStable();
    expect(api.artifactLinks).toHaveBeenLastCalledWith(
      { spaceID: 'space', projectID: 'project' },
      'watch',
      'watch1',
      '',
      expect.any(AbortSignal),
      'prod',
    );
  });
});
