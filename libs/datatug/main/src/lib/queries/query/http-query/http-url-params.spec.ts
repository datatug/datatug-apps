import { parseUrlParams, withUrlParams } from './http-url-params';

describe('http url params', () => {
  it('parses decoded pairs and keeps order', () => {
    expect(parseUrlParams('https://x.test/a?b=1&c=hello%20w&d')).toEqual([
      { name: 'b', value: '1' },
      { name: 'c', value: 'hello w' },
      { name: 'd', value: '' },
    ]);
    expect(parseUrlParams('https://x.test/a')).toEqual([]);
  });

  it('rewrites the query string and keeps base and hash', () => {
    expect(
      withUrlParams('https://x.test/a?old=1#frag', [
        { name: 'q', value: 'a b&c' },
      ]),
    ).toBe('https://x.test/a?q=a%20b%26c#frag');
  });

  it('drops the ? when no params remain and skips unnamed rows', () => {
    expect(withUrlParams('https://x.test/a?x=1', [])).toBe('https://x.test/a');
    expect(withUrlParams('https://x.test/a', [{ name: '', value: 'v' }])).toBe(
      'https://x.test/a',
    );
  });

  it('keeps {{template}} braces readable', () => {
    expect(
      withUrlParams('https://x.test', [{ name: 'k', value: '{{token}}' }]),
    ).toBe('https://x.test?k={{token}}');
  });

  it('decodes + as a space', () => {
    expect(parseUrlParams('https://x.test/a?q=a+b&c%2Bd=1')).toEqual([
      { name: 'q', value: 'a b' },
      { name: 'c+d', value: '1' },
    ]);
  });

  it('keeps the original encoding of untouched params', () => {
    const url = 'https://x.test/a?q=a+b&n=1&p=%7Bx%7D%2f#frag';
    const rows = parseUrlParams(url).map((r) =>
      r.name === 'n' ? { ...r, value: '2' } : r,
    );
    expect(withUrlParams(url, rows)).toBe(
      'https://x.test/a?q=a+b&n=2&p=%7Bx%7D%2f#frag',
    );
    expect(withUrlParams(url, parseUrlParams(url))).toBe(url);
  });

  it('handles duplicate keys by position', () => {
    const url = 'https://x.test/?a=x%20y&a=2&a=2';
    const rows = parseUrlParams(url);
    expect(rows.map((r) => r.value)).toEqual(['x y', '2', '2']);
    rows[2] = { name: 'a', value: '3' };
    expect(withUrlParams(url, rows)).toBe('https://x.test/?a=x%20y&a=2&a=3');
    expect(withUrlParams(url, rows.slice(1))).toBe('https://x.test/?a=2&a=3');
  });

  it('keeps an empty-name row out of the URL but in the rows given', () => {
    const url = 'https://x.test/?a=1';
    const rows = [...parseUrlParams(url), { name: '', value: 'v' }];
    expect(withUrlParams(url, rows)).toBe(url);
    expect(withUrlParams(url, [{ name: '', value: '' }])).toBe(
      'https://x.test/',
    );
  });

  it('does not encode / in values', () => {
    expect(
      withUrlParams('https://x.test', [{ name: 'path', value: 'a/b c' }]),
    ).toBe('https://x.test?path=a/b%20c');
  });

  it('keeps a fragment when there is no query', () => {
    expect(
      withUrlParams('https://x.test/a#top', [{ name: 'k', value: 'v' }]),
    ).toBe('https://x.test/a?k=v#top');
  });
});
