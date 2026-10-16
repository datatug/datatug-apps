import { linkBackHref } from './link-route';

describe('linkBackHref', () => {
  it('is the home of the project of the page', () => {
    expect(linkBackHref('http-127.0.0.1:8989', 'demo')).toBe(
      '/store/http-127.0.0.1:8989/project/demo',
    );
  });

  it('is the store page when the page has no project', () => {
    expect(linkBackHref('http-127.0.0.1:8989', undefined)).toBe(
      '/store/http-127.0.0.1:8989',
    );
  });

  it('is the root when there is no store either', () => {
    expect(linkBackHref('', undefined)).toBe('/');
  });
});
