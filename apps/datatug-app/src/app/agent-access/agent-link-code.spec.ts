import { loopbackAgentOrigin, takeAgentLinkCode } from './agent-link-code';

const CODE = 'v1.1792095344.kz0q4SaCCuHIdaTV3Y-W6A.RJJfn_yXhLoDMUzD5L2EeSvz';
const PK = 'pk=%7B%22PlaylistId%22%3A1%2C%22TrackId%22%3A3402%7D';
const RECORD_PATH =
  '/store/http-127.0.0.1:8989/project/demo/env/local/db/chinook/table/PlaylistTrack/record';

function open(pathname: string, search: string, hash: string) {
  const hist = { state: { navigationId: 1 }, replaceState: vi.fn() };
  const result = takeAgentLinkCode({ pathname, search, hash }, hist);
  return { result, hist };
}

describe('loopbackAgentOrigin', () => {
  it.each([
    ['http://127.0.0.1:8989/datatug/exec/select?db=x', 'http://127.0.0.1:8989'],
    ['http://localhost:8989/datatug', 'http://localhost:8989'],
    ['https://127.0.0.1:9000/', 'https://127.0.0.1:9000'],
    ['http://[::1]:8989/datatug', 'http://[::1]:8989'],
  ])('%s is the loopback agent %s', (url, origin) => {
    expect(loopbackAgentOrigin(url)).toBe(origin);
  });

  it.each([
    'https://datatug.app/store/http-127.0.0.1:8989',
    'http://127.0.0.1.evil.com:8989/',
    'http://user:pw@127.0.0.1:8989/',
    'about:blank',
    'not a url',
    'ftp://127.0.0.1/',
  ])('%s is not a loopback agent', (url) => {
    expect(loopbackAgentOrigin(url)).toBeUndefined();
  });
});

describe('takeAgentLinkCode', () => {
  it('takes the code of a record link and leaves the key in the fragment', () => {
    const { result, hist } = open(RECORD_PATH, '?schema=', `#code=${CODE}&${PK}`);
    expect(result).toEqual({ origin: 'http://127.0.0.1:8989', code: CODE });
    expect(hist.replaceState).toHaveBeenCalledWith(
      { navigationId: 1 },
      '',
      `${RECORD_PATH}?schema=#${PK}`,
    );
  });

  it('removes the whole fragment of a metadata link, which holds only the code', () => {
    const path =
      '/store/http-127.0.0.1:8989/project/demo/env/local/db/chinook/table/Album';
    const { result, hist } = open(path, '?schema=', `#code=${CODE}`);
    expect(result?.code).toBe(CODE);
    expect(hist.replaceState).toHaveBeenCalledWith(expect.anything(), '', `${path}?schema=`);
  });

  it('leaves an address with no code alone', () => {
    const { result, hist } = open(RECORD_PATH, '?schema=', `#${PK}`);
    expect(result).toBeUndefined();
    expect(hist.replaceState).not.toHaveBeenCalled();
    expect(open('/login', '', '#/subscriptions').hist.replaceState).not.toHaveBeenCalled();
  });

  it('strips but never exchanges a code for an address that names no loopback agent', () => {
    const { result, hist } = open('/store/http-example.com:8989/project/p', '', `#code=${CODE}`);
    expect(result).toBeUndefined();
    expect(hist.replaceState).toHaveBeenCalledWith(expect.anything(), '', '/store/http-example.com:8989/project/p');
    expect(open('/', '', `#code=${CODE}`).result).toBeUndefined();
  });

  it.each([
    ['two codes', `#code=${CODE}&code=${CODE}`],
    ['markup', '#code=%3Cscript%3E'],
    ['a URL', '#code=https%3A%2F%2Fevil.example'],
    ['bad percent-encoding', '#code=%E0%A4%A'],
    ['an empty code', '#code='],
    ['an oversized code', `#code=${'a'.repeat(513)}`],
  ])('refuses %s and still strips it', (_name, hash) => {
    const { result, hist } = open(RECORD_PATH, '', hash);
    expect(result).toBeUndefined();
    expect(hist.replaceState).toHaveBeenCalledOnce();
    expect(hist.replaceState.mock.calls[0][2]).not.toContain('code=');
  });

  it('never cuts into a key holding &code=, as the router leaves it bare in the address bar after a reload', () => {
    const key = '{"T":"x&code=1&"}';
    // As daemon url writes it: one code, then the encoded key.
    const first = open(RECORD_PATH, '?schema=', `#code=${CODE}&pk=${encodeURIComponent(key)}`);
    expect(first.result?.code).toBe(CODE);
    // The router re-serializes the decoded fragment with encodeURI, leaving & bare; a reload reads that.
    const rewritten = '#' + encodeURI(decodeURIComponent(first.hist.replaceState.mock.calls[0][2].split('#')[1]));
    expect(rewritten).toContain('x&code=1&');
    const reload = open(RECORD_PATH, '?schema=', rewritten);
    expect(reload.result).toBeUndefined();
    expect(reload.hist.replaceState).not.toHaveBeenCalled();
    expect(decodeURIComponent(rewritten.slice(1))).toBe(`pk=${key}`);
  });
});
