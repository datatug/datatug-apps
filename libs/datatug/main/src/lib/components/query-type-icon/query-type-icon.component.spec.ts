import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  QueryTypeIconComponent,
  queryTypeKey,
  queryTypeLabel,
} from './query-type-icon.component';

describe('query type helpers', () => {
  it('maps each known type to its colour token and anything else to grey', () => {
    expect(queryTypeKey('SQL')).toBe('sql');
    expect(queryTypeKey('sql')).toBe('sql');
    expect(queryTypeKey('tugql')).toBe('tugql');
    expect(queryTypeKey('TugQL')).toBe('tugql');
    // Full cutover: the old DTQL value has no alias.
    expect(queryTypeKey('DTQL')).toBe('other');
    expect(queryTypeKey('HTTP')).toBe('http');
    expect(queryTypeKey('GraphQL')).toBe('other');
    expect(queryTypeKey(undefined)).toBe('other');
  });

  it('labels the badge with the display name', () => {
    expect(queryTypeLabel('tugql')).toBe('TugQL');
    expect(queryTypeLabel('SQL')).toBe('SQL');
    expect(queryTypeLabel('GraphQL')).toBe('GraphQL');
    expect(queryTypeLabel('HTTP')).toBe('HTTP');
    expect(queryTypeLabel(' ')).toBe('?');
    expect(queryTypeLabel(undefined)).toBe('?');
  });
});

describe('QueryTypeIconComponent', () => {
  async function render(type: string | undefined) {
    await TestBed.configureTestingModule({
      imports: [QueryTypeIconComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(QueryTypeIconComponent);
    fixture.componentRef.setInput('type', type);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders a neutral query icon with a typed, decorative badge and screen-reader text', async () => {
    const el = await render('tugql');
    const wrapper = el.querySelector('.query-type-icon');
    expect(wrapper?.getAttribute('data-query-type')).toBe('tugql');
    const icon = el.querySelector('ion-icon');
    expect(icon?.getAttribute('name')).toBe('document-text-outline');
    // Neutral: the icon takes no Ionic colour (primary or type); only the badge is coloured.
    expect(icon?.hasAttribute('color')).toBe(false);
    const badge = el.querySelector('.query-type-badge');
    expect(badge?.innerHTML).toBe('TugQL');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.visually-hidden')?.innerHTML).toBe('TugQL query');
  });

  it('uses the grey token for an unknown type', async () => {
    const el = await render('GraphQL');
    expect(
      el.querySelector('.query-type-icon')?.getAttribute('data-query-type'),
    ).toBe('other');
  });
});
