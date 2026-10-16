import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, of } from 'rxjs';
import { DetectiveClientService } from './detective-client.service';
import { DetectiveDemoStarterComponent } from './detective-demo-starter.component';

describe('DetectiveDemoStarterComponent', () => {
  let fixture: ComponentFixture<DetectiveDemoStarterComponent>;
  let authState: BehaviorSubject<{ status: string; user?: { uid: string } }>;
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  let privateDemo: { storeId: string; spaceID: string; projectId: string };
  let client: { demoProject: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authState = new BehaviorSubject({ status: 'notAuthenticated' });
    privateDemo = {
      storeId: 'firestore',
      spaceID: 'private-space',
      projectId: 'private-project',
    };
    router = { navigateByUrl: vi.fn().mockResolvedValue(true) };
    client = { demoProject: vi.fn(() => of(privateDemo)) };
    const auth = {
      authState: authState.asObservable(),
      signInWith: vi.fn(async () =>
        authState.next({ status: 'authenticated', user: { uid: 'user-1' } }),
      ),
    };
    await TestBed.configureTestingModule({
      imports: [DetectiveDemoStarterComponent],
      providers: [
        { provide: SneatAuthStateService, useValue: auth },
        { provide: DetectiveClientService, useValue: client },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DetectiveDemoStarterComponent);
  });

  it('signs in, creates a private demo, and opens its Sessions destination', async () => {
    fixture.componentRef.setInput('destination', 'sessions');
    fixture.detectChanges();
    await (
      fixture.componentInstance as unknown as { start(): Promise<void> }
    ).start();

    expect(client.demoProject).toHaveBeenCalledOnce();
    expect(router.navigateByUrl).toHaveBeenCalledWith(
      '/space/private-space/store/firestore/project/private-project/sessions',
    );
  });

  it('keeps the existing Detective destination for incident authoring', async () => {
    fixture.componentRef.setInput('destination', 'detective');
    fixture.detectChanges();
    await (
      fixture.componentInstance as unknown as { start(): Promise<void> }
    ).start();

    expect(router.navigateByUrl).toHaveBeenCalledWith(
      '/space/private-space/store/firestore/project/private-project/detective',
    );
  });
});
