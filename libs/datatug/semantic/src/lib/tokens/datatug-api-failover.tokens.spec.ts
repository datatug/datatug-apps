import { TestBed } from '@angular/core/testing';
import { DefaultSneatAppApiBaseUrl, SneatApiBaseUrl } from '@sneat/api';
import { DatatugApiBaseUrl } from './datatug-api-base-url.token';
import {
  DEFAULT_DATATUG_API_FAILOVER_CONFIG,
  DatatugApiBaseUrls,
  DatatugApiFailoverConfig,
} from './datatug-api-failover.tokens';

describe('DatatugApiBaseUrls', () => {
  it('defaults to the single DatatugApiBaseUrl, which keeps today\'s behaviour', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(DatatugApiBaseUrls)).toEqual([
      DefaultSneatAppApiBaseUrl,
    ]);
  });

  it('follows SneatApiBaseUrl through DatatugApiBaseUrl', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: SneatApiBaseUrl, useValue: 'https://x.test/v0/' }],
    });
    expect(TestBed.inject(DatatugApiBaseUrls)).toEqual(['https://x.test/v0/']);
  });

  it('follows an explicit DatatugApiBaseUrl', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiBaseUrl, useValue: 'https://d.test/v0/' }],
    });
    expect(TestBed.inject(DatatugApiBaseUrls)).toEqual(['https://d.test/v0/']);
  });

  it('lets a build provide an ordered primary and fallback list', () => {
    const urls = ['https://api.datatug.app/v0/', 'https://api2.datatug.app/v0/'];
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiBaseUrls, useValue: urls }],
    });
    expect(TestBed.inject(DatatugApiBaseUrls)).toEqual(urls);
  });
});

describe('DatatugApiFailoverConfig', () => {
  it('defaults to a 5 minute breaker and a short primary timeout', () => {
    TestBed.configureTestingModule({});
    const config = TestBed.inject(DatatugApiFailoverConfig);
    expect(config).toBe(DEFAULT_DATATUG_API_FAILOVER_CONFIG);
    expect(config.breakerMinutes).toBe(5);
    expect(config.primaryTimeoutMs).toBe(8_000);
    expect(config.slowEndpointTimeoutMs).toBeGreaterThan(config.primaryTimeoutMs);
  });
});
