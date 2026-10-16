import { AgentTableSchema } from './agent-link-api.service';
import { recordsLimit } from './link-route';
import { lookupKey, parseKeyObject, pkOfRouteFragment } from './record-key';

const PLAYLIST_TRACK: AgentTableSchema = {
  columns: [
    { name: 'PlaylistId', type: 'int' },
    { name: 'TrackId', type: 'int' },
  ],
  primaryKey: ['PlaylistId', 'TrackId'],
  referencedBy: [],
  foreignKeys: [],
};
const ALBUM: AgentTableSchema = {
  columns: [
    { name: 'AlbumId', type: 'int' },
    { name: 'Title', type: 'string' },
  ],
  primaryKey: ['AlbumId'],
  referencedBy: ["Track"],
  foreignKeys: [],
};
const BY_CODE: AgentTableSchema = {
  columns: [
    { name: 'Code', type: 'TEXT' },
    { name: 'Rate', type: 'real' },
  ],
  primaryKey: ['Code'],
  referencedBy: [],
  foreignKeys: [],
};

function keyOf(text: string, schema: AgentTableSchema) {
  const parsed = parseKeyObject(text);
  return parsed && lookupKey(parsed, schema);
}

describe('pkOfRouteFragment (the fragment as the router decodes it)', () => {
  it.each([
    ['pk={"Code":"AT&T"}', '{"Code":"AT&T"}'],
    ['code=v1.x&pk={"Code":"a&pk=b"}', '{"Code":"a&pk=b"}'],
    ['pk={"PlaylistId":1,"TrackId":3402}', '{"PlaylistId":1,"TrackId":3402}'],
  ])('%s', (fragment, json) => expect(pkOfRouteFragment(fragment)).toBe(json));

  it.each(['', 'code=v1.x', 'xpk=1', 'pk=', null, undefined])('%s has no key', (fragment) =>
    expect(pkOfRouteFragment(fragment)).toBeUndefined(),
  );
});

describe('the key of a record link (REQ:key-lossless, REQ:ui-record-lookup)', () => {
  it('keeps a composite integer key typed', () => {
    expect(keyOf('{"PlaylistId":1,"TrackId":3402}', PLAYLIST_TRACK)).toEqual({
      PlaylistId: 1,
      TrackId: 3402,
    });
  });

  it('sends 9007199254740993 with every digit, never its neighbour', () => {
    // As daemon url writes it (a string) and as a hand-written number literal.
    expect(keyOf('{"AlbumId":"9007199254740993"}', ALBUM)).toEqual({ AlbumId: '9007199254740993' });
    expect(keyOf('{"AlbumId":9007199254740993}', ALBUM)).toEqual({ AlbumId: '9007199254740993' });
    expect(keyOf('{"AlbumId":-9007199254740993}', ALBUM)).toEqual({ AlbumId: '-9007199254740993' });
    expect(keyOf('{"AlbumId":9007199254740991}', ALBUM)).toEqual({ AlbumId: 9007199254740991 });
  });

  it('reads a string key as it is, including characters that look like SQL', () => {
    expect(keyOf('{"Code":"a\'b; drop table x"}', BY_CODE)).toEqual({ Code: "a'b; drop table x" });
  });

  it.each([
    ['injection text in an integer column', '{"AlbumId":"1 OR 1=1"}'],
    ['a non-key column', '{"Title":"x"}'],
    ['a key and a non-key column', '{"AlbumId":1,"Title":"x"}'],
    ['an unknown column', '{"Nope":1}'],
    ['an empty object', '{}'],
    ['a fraction', '{"AlbumId":1.5}'],
    ['an exponent', '{"AlbumId":1e3}'],
    ['a leading zero', '{"AlbumId":"01"}'],
    ['minus zero', '{"AlbumId":"-0"}'],
    ['null', '{"AlbumId":null}'],
    ['a boolean', '{"AlbumId":true}'],
    ['an object', '{"AlbumId":{"x":1}}'],
    ['an array', '{"AlbumId":[1]}'],
    ['a column named twice', '{"AlbumId":1,"AlbumId":2}'],
    ['trailing text', '{"AlbumId":1} OR 1=1'],
    ['not JSON', 'AlbumId=1'],
    ['an array at the top', '[1]'],
  ])('refuses %s (bad-key, no lookup)', (_name, text) => {
    expect(keyOf(text, ALBUM)).toBeUndefined();
  });

  it('refuses a number for a string column, an oversized string, and a key type the lookup cannot read', () => {
    expect(keyOf('{"Code":1}', BY_CODE)).toBeUndefined();
    expect(keyOf(`{"Code":"${'x'.repeat(257)}"}`, BY_CODE)).toBeUndefined();
    expect(
      keyOf('{"Rate":1}', { ...BY_CODE, primaryKey: ['Rate'] }),
    ).toBeUndefined();
    expect(keyOf('{"AlbumId":1}', { ...ALBUM, primaryKey: [] })).toBeUndefined();
  });

  it('refuses a raw control character and a bad escape in a string', () => {
    expect(parseKeyObject('{"a":"x\\u0001"}')?.get('a')).toEqual({ kind: 'string', value: 'x' + String.fromCharCode(1) });
    expect(parseKeyObject('{"a":"x' + String.fromCharCode(1) + '"}')).toBeUndefined();
    expect(parseKeyObject('{"a":"\\q"}')).toBeUndefined();
  });

  it('parses escapes and whitespace', () => {
    expect(parseKeyObject(' { "a\\"b" : "c\\u0041" } ')?.get('a"b')).toEqual({ kind: 'string', value: 'cA' });
  });
});

describe('recordsLimit (REQ:ui-routes)', () => {
  it.each([
    [null, 50],
    ['', 50],
    ['100', 100],
    ['1', 1],
    ['1000', 1000],
    ['1001', 1000],
    ['999999999999', 1000],
    ['0', 50],
    ['-5', 50],
    ['10.5', 50],
    ['1e3', 50],
    ['abc', 50],
  ])('limit=%s reads %i rows', (param, n) => expect(recordsLimit(param)).toBe(n));
});
