import { AgentForeignKey, AgentTableRef } from './agent-link-api.service';
import { DefaultUrlSerializer } from '@angular/router';
import { lookupKey, parseKeyObject, pkOfRouteFragment } from './record-key';
import { recordHops } from './record-hops';

const REF: AgentTableRef = {
  storeId: 'http-127.0.0.1:8989',
  project: 'demo',
  env: 'local',
  source: 'chinook',
  table: { schema: '', name: 'Album' },
};
const TO_ARTIST: AgentForeignKey = {
  name: 'Album_fk_0',
  columns: ['ArtistId'],
  refTable: { schema: 'main', name: 'Artist' },
  refColumns: ['ArtistId'],
};
const COMPOSITE: AgentForeignKey = {
  name: 'fk_pt',
  columns: ['PId', 'TCode'],
  refTable: { schema: 'main', name: 'PT' },
  refColumns: ['PlaylistId', 'TrackCode'],
};

describe('recordHops (plan Task 9: foreign-key hops)', () => {
  it('opens the referenced record by its typed key, only in the fragment', () => {
    const [hop] = recordHops(REF, [TO_ARTIST], ['AlbumId', 'Title', 'ArtistId'], [
      { type: 'integer', text: '1' },
      { type: 'string', text: 'For Those About To Rock' },
      { type: 'integer', text: '9007199254740993' },
    ]);
    expect(hop.commands).toEqual([
      '/store', 'http-127.0.0.1:8989', 'project', 'demo', 'env', 'local', 'db', 'chinook', 'table', 'Artist', 'record',
    ]);
    expect(hop.schema).toBe('main');
    // Every digit, as a JSON number literal; no non-key value.
    expect(hop.fragment).toBe('pk={"ArtistId":9007199254740993}');
    expect(hop.commands.join('/')).not.toContain('9007199254740993');
  });

  it('maps a composite key column by column, with string values as JSON', () => {
    const [hop] = recordHops(REF, [COMPOSITE], ['TCode', 'PId'], [
      { type: 'string', text: 'a"&b' },
      { type: 'integer', text: '7' },
    ]);
    expect(JSON.parse(hop.fragment.slice('pk='.length))).toEqual({ PlaylistId: 7, TrackCode: 'a"&b' });
  });

  it('round-trips & " # % and non-ASCII through the router and the record page reader', () => {
    const [hop] = recordHops(REF, [COMPOSITE], ['TCode', 'PId'], [
      { type: 'string', text: 'a&b"#%26 ü' },
      { type: 'integer', text: '9007199254740993' },
    ]);
    // As the router writes the address bar.
    const serializer = new DefaultUrlSerializer();
    const tree = serializer.parse('/x');
    tree.fragment = hop.fragment; // as routerLink's [fragment] sets it
    const url = serializer.serialize(tree);
    // A reload parses that address again; the record page reads the router's fragment.
    expect(url).not.toMatch(/#.*[^\\]&/);
    const key = parseKeyObject(pkOfRouteFragment(serializer.parse(url).fragment) ?? '');
    expect(key).toBeDefined();
    if (!key) return;
    expect(
      lookupKey(key, {
        columns: [
          { name: 'PlaylistId', type: 'int' },
          { name: 'TrackCode', type: 'string' },
        ],
        primaryKey: ['PlaylistId', 'TrackCode'],
        referencedBy: [],
        foreignKeys: [],
      }),
    ).toEqual({ PlaylistId: '9007199254740993', TrackCode: 'a&b"#%26 ü' });
  });

  it('has no hop for a string over 256 bytes', () => {
    expect(recordHops(REF, [COMPOSITE], ['TCode', 'PId'], [
      { type: 'string', text: 'ü'.repeat(129) },
      { type: 'integer', text: '1' },
    ])).toEqual([]);
  });

  it.each([
    ['a null value', { type: 'null', text: '' }],
    ['a decimal value', { type: 'decimal', text: '1.5' }],
    ['a malformed integer', { type: 'integer', text: '1e3' }],
  ])('has no hop for %s', (_name, cell) => {
    expect(recordHops(REF, [TO_ARTIST], ['ArtistId'], [cell])).toEqual([]);
  });

  it('has no hop when the record lacks a key column', () => {
    expect(recordHops(REF, [TO_ARTIST], ['AlbumId'], [{ type: 'integer', text: '1' }])).toEqual([]);
  });
});
