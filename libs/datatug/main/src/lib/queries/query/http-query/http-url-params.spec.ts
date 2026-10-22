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
});
