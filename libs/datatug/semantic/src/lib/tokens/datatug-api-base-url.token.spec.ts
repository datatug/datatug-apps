import { TestBed } from '@angular/core/testing';
import { DefaultSneatAppApiBaseUrl, SneatApiBaseUrl } from '@sneat/api';
import {
  DATATUG_TEST_PREVIEW_API_BASE_URL,
  DatatugApiBaseUrl,
} from './datatug-api-base-url.token';

describe('DatatugApiBaseUrl', () => {
  it('falls back to DefaultSneatAppApiBaseUrl when no SneatApiBaseUrl is provided', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(DatatugApiBaseUrl)).toBe(DefaultSneatAppApiBaseUrl);
  });

  it('mirrors SneatApiBaseUrl when it is provided', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SneatApiBaseUrl, useValue: 'https://local.test/v0/' },
      ],
    });
    expect(TestBed.inject(DatatugApiBaseUrl)).toBe('https://local.test/v0/');
  });

  it('lets an explicit DatatugApiBaseUrl win over SneatApiBaseUrl', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SneatApiBaseUrl, useValue: 'https://sneat.test/v0/' },
        { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
      ],
    });
    expect(TestBed.inject(DatatugApiBaseUrl)).toBe('https://datatug.test/v0/');
    expect(TestBed.inject(SneatApiBaseUrl)).toBe('https://sneat.test/v0/');
  });

  it('names the Belgium datatug-cloud-preview as the TEST project preview base URL', () => {
    expect(DATATUG_TEST_PREVIEW_API_BASE_URL).toBe(
      'https://datatug-cloud-preview-354fvnqbaa-ew.a.run.app/v0/',
    );
  });
});
