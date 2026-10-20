import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { Subject } from 'rxjs';

import { MyStoresComponent } from './my-stores.component';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';

describe('MyStoresComponent', () => {
  let component: MyStoresComponent;
  let fixture: ComponentFixture<MyStoresComponent>;
  let userStates$: Subject<unknown>;

  beforeEach(async () => {
    userStates$ = new Subject();
    await TestBed.configureTestingModule({
      imports: [MyStoresComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: DatatugNavService, useValue: { goStore: vi.fn() } },
        {
          provide: DatatugUserService,
          useValue: {
            datatugUserState: userStates$.asObservable(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MyStoresComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows connected stores first with one type-specific description per row', async () => {
    expect(fixture.nativeElement.textContent).toContain('Project stores');
    expect(fixture.nativeElement.textContent).toContain('DataTug Cloud');
    expect(fixture.nativeElement.textContent).toContain('GitHub');
    expect(
      fixture.nativeElement.querySelectorAll('.store-options ion-item'),
    ).toHaveLength(3);

    userStates$.next({ status: 'authenticated', record: null });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Connected stores');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Compare storage options',
    );
    expect(
      fixture.nativeElement.querySelectorAll('.connected-stores ion-item'),
    ).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('GitHub.com');
    expect(fixture.nativeElement.textContent).toContain(
      'Fastest setup, with live updates from Cloud storage.',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'version history and branches',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'offline use where supported',
    );
    expect(fixture.nativeElement.querySelector('.store-options')).toBeNull();
    expect(fixture.nativeElement.querySelector('.storage-visual')).toBeTruthy();
    expect(
      Array.from<Element>(
        fixture.nativeElement.querySelectorAll(
          '.connected-stores ion-icon[slot="start"]',
        ),
      ).map((icon: Element) => icon.getAttribute('name')),
    ).toEqual(['cloud-outline', 'logo-github', 'terminal-outline']);
  });

  it('shows storage options with the same descriptions for signed-out visitors', async () => {
    userStates$.next({ status: 'notAuthenticated', record: null });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.store-options')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('.storage-visual')?.getAttribute('src'),
    ).toBe('assets/home/storage-harbour-pencil.webp');
    expect(
      fixture.nativeElement.querySelectorAll('.store-options ion-item'),
    ).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain(
      'Choose where project files live',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Fastest setup, with live updates from Cloud storage.',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'version history and branches',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'offline use where supported',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Connected stores');
    expect(
      Array.from<Element>(
        fixture.nativeElement.querySelectorAll(
          '.store-options ion-icon[slot="start"]',
        ),
      ).map((icon: Element) => icon.getAttribute('name')),
    ).toEqual(['cloud-outline', 'logo-github', 'terminal-outline']);
  });
});
