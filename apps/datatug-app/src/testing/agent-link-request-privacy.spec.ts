import { describe, expect, it } from 'vitest';
import { recordKeyRequestUrl } from '../../e2e/agent-links/fixtures/request-privacy';

const APP = 'http://datatug.localhost:4312';
// Exact request from CI run39445099758: its cache timestamp happens to contain the fixture key3402.
const HISTORICAL = `${APP}/@ng/component?c=libs%2Fdatatug%2Fsemantic%2Fsrc%2Flib%2Fcomponents%2Fsource-rights-notice.component.ts%40SourceRightsNoticeComponent&t=1792509034022`;

describe('record-key request privacy check', () => {
  it('does not mistake the historical Angular cache timestamp for the record key', () => {
    expect(HISTORICAL).toContain('3402');
    const checked = recordKeyRequestUrl(HISTORICAL, APP, 'GET');
    expect(checked).not.toContain('3402');
    expect(new URL(checked).pathname).toBe('/@ng/component');
    expect(new URL(checked).searchParams.get('c')).toBe(
      new URL(HISTORICAL).searchParams.get('c'),
    );
  });

  it.each([
    `${APP}/record/3402?t=1792509034022`,
    `${APP}/@ng/component?c=component&t=1792509034022&pk=3402`,
    `${APP}/@ng/component?c=component&t=1792509034022&pk=safe&pk=3402`,
    `${APP}/@ng/component?c=component3402&t=1792509034022`,
    `${APP}/@ng/component?c=component&t=1792509034022&t=3402`,
    'http://127.0.0.1:8989/@ng/component?c=component&t=1792509034022',
    'http://127.0.0.1:8989/datatug/records/lookup?key=3402&t=1792509034022',
    'https://example.test/@ng/component?c=component&t=1792509034022',
    'http://datatug.localhost.example.test:4312/@ng/component?c=component&t=1792509034022',
    `${APP}/@ng/component?c=component&t=3402`,
    `${APP}/@ng/component?c=component&t=bad3402`,
    `${APP}/@ng/component?c=component&t=179250903402`,
    `${APP}/@ng/component?c=component&t=17925090340222`,
  ])('keeps key-bearing path/query/agent data visible: %s', (url) => {
    expect(recordKeyRequestUrl(url, APP, 'GET')).toContain('3402');
  });

  it('preserves every repeated non-t parameter in a normalized request', () => {
    const url = `${APP}/@ng/component?c=one&c=two&t=1792509034022&pk=3402&pk=safe`;
    const checked = new URL(recordKeyRequestUrl(url, APP, 'GET'));
    expect(checked.searchParams.getAll('c')).toEqual(['one', 'two']);
    expect(checked.searchParams.getAll('pk')).toEqual(['3402', 'safe']);
  });

  it('keeps POST addresses and malformed URLs unchanged', () => {
    expect(recordKeyRequestUrl(HISTORICAL, APP, 'POST')).toBe(HISTORICAL);
    expect(recordKeyRequestUrl('not-a-url3402', APP, 'GET')).toBe(
      'not-a-url3402',
    );
  });
});
