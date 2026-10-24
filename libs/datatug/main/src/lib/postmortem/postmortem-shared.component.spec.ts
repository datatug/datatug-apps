import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { DatatugApiBaseUrl } from '@sneat/datatug-semantic';
import {
  PostmortemSharedComponent,
  POSTMORTEM_SHARE_TOKEN,
} from './postmortem-shared.component';
const token = 'space.project.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijk';
describe('isolated public report rendering', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [PostmortemSharedComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatatugApiBaseUrl, useValue: 'https://api.example/v0/' },
        { provide: POSTMORTEM_SHARE_TOKEN, useValue: token },
      ],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('sends the share capability only in its dedicated header and renders safe escaped content', async () => {
    const host = TestBed.createComponent(PostmortemSharedComponent);
    host.detectChanges();
    const request = TestBed.inject(HttpTestingController).expectOne(
      'https://api.example/v0/datatug/postmortems/shared',
    );
    expect(request.request.headers.get('Authorization')).toBe(
      `Bearer ${token}`,
    );
    expect(request.request.urlWithParams).not.toContain(token);
    request.flush({
      id: 'publication',
      workItemId: 'private',
      revision: 1,
      digest: 'digest',
      content: {
        sections: [
          {
            name: 'root-cause',
            classification: 'unknown',
            text: '<img src=x onerror=alert(1)>',
            evidenceIds: [],
          },
        ],
        safeCitationLabels: [],
        proposalSummaries: [],
      },
    });
    await Promise.resolve();
    await host.whenStable();
    expect(host.nativeElement.textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
    expect(host.nativeElement.querySelector('img')).toBeNull();
    expect(host.nativeElement.textContent).not.toContain('private');
  });
  it('uses a generic unavailable state on revoked or expired capability', async () => {
    const host = TestBed.createComponent(PostmortemSharedComponent);
    host.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('https://api.example/v0/datatug/postmortems/shared')
      .flush({}, { status: 404, statusText: 'Not found' });
    await Promise.resolve();
    await host.whenStable();
    expect(host.nativeElement.textContent).toContain(
      'unavailable, expired or revoked',
    );
  });
});
