import { AgentForeignKey, AgentTableRef } from './agent-link-api.service';
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
