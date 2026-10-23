import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  QueryItemHeadingComponent,
  formatQueryTimestamp,
} from './query-item-heading';

// Local-time instants, so the "today" rule does not depend on the runner's time zone.
const now = new Date(2026, 9, 23, 16, 30);
const iso = (y: number, m: number, d: number, h = 14, min = 5) =>
  new Date(y, m, d, h, min).toISOString();

describe('formatQueryTimestamp', () => {
  it('shows the time for a query added today', () => {
    const stamp = formatQueryTimestamp(
      iso(2026, 9, 23),
      undefined,
      now,
      'en-GB',
    );
    expect(stamp?.short).toBe('14:05');
    expect(stamp?.full).toBe('Added 23 Oct 2026, 14:05');
  });

  it('shows day and month for another day this year', () => {
    const stamp = formatQueryTimestamp(
      iso(2026, 9, 22),
      undefined,
      now,
      'en-GB',
    );
    expect(stamp?.short).toBe('22 Oct');
    expect(stamp?.full).toBe('Added 22 Oct 2026, 14:05');
  });

  it('adds the year for another year', () => {
    const stamp = formatQueryTimestamp(
      iso(2025, 11, 31),
      undefined,
      now,
      'en-GB',
    );
    expect(stamp?.short).toBe('31 Dec 2025');
  });

  it('follows the locale', () => {
    const stamp = formatQueryTimestamp(
      iso(2026, 9, 22),
      undefined,
      now,
      'en-US',
    );
    expect(stamp?.short).toBe('Oct 22');
  });

  it('adds the modification time to the tooltip text when known', () => {
    const stamp = formatQueryTimestamp(
      iso(2026, 9, 22),
      iso(2026, 9, 23, 9, 0),
      now,
      'en-GB',
    );
    expect(stamp?.full).toBe(
      'Added 22 Oct 2026, 14:05. Modified 23 Oct 2026, 09:00',
    );
  });

  it('returns nothing without a valid creation time', () => {
    expect(formatQueryTimestamp(undefined)).toBeUndefined();
    expect(formatQueryTimestamp('not a date')).toBeUndefined();
  });
});

describe('QueryItemHeadingComponent', () => {
  it('puts the title and a hover/accessible timestamp on one line', async () => {
    await TestBed.configureTestingModule({
      imports: [QueryItemHeadingComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(QueryItemHeadingComponent);
    const createdAt = iso(2024, 0, 5);
    fixture.componentRef.setInput('queryTitle', 'Orders by country');
    fixture.componentRef.setInput('createdAt', createdAt);
    fixture.componentRef.setInput('testId', 'saved-query-orders');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const heading = el.querySelector('.query-item-heading');
    const title = heading?.querySelector('h3');
    expect(title?.getAttribute('data-testid')).toBe('saved-query-orders');
    expect(title?.innerHTML.trim()).toBe('Orders by country');
    const time = heading?.querySelector('time');
    const expected = formatQueryTimestamp(createdAt);
    expect(time?.getAttribute('datetime')).toBe(expected?.iso);
    expect(time?.getAttribute('title')).toBe(expected?.full);
    expect(time?.querySelector('[aria-hidden="true"]')?.innerHTML).toBe(
      expected?.short,
    );
    expect(time?.querySelector('.visually-hidden')?.innerHTML).toBe(
      expected?.full,
    );
  });

  it('omits the timestamp when the query has no creation time', async () => {
    await TestBed.configureTestingModule({
      imports: [QueryItemHeadingComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(QueryItemHeadingComponent);
    fixture.componentRef.setInput('queryTitle', 'Draft');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('time')).toBeNull();
  });
});
