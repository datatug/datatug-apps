import {
  groupSearchItems,
  SearchDocument,
  searchChipLabel,
  searchItemHref,
  searchNameHref,
} from './quick-search-model';
import { schemaDocuments } from './quick-search-snapshot.service';

const table = (sourceName: string, id = sourceName): SearchDocument => ({
  kind: 'table',
  id,
  name: 'Customers',
  sourceName,
  tags: [],
  reference: { dbModelId: sourceName, schema: 'dbo', table: 'Customers' },
});
describe('Quick Search grouped typed results', () => {
  it('groups normalized names while retaining same-kind objects from each source', () => {
    const items = [
      table('Chinook'),
      { ...table('Northwind'), name: ' customers ' },
    ];
    const groups = groupSearchItems(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
    expect(
      groups[0].items.map((item) => searchChipLabel(item, groups[0])),
    ).toEqual(['Table@Chinook', 'Table@Northwind']);
  });
  it('disambiguates two objects sharing source and kind without losing a chip', () => {
    const groups = groupSearchItems([
      table('DB', 'one'),
      {
        ...table('DB', 'two'),
        qualifiedName: 'other.Customers',
        reference: { dbModelId: 'DB', schema: 'other', table: 'Customers' },
      },
    ]);
    expect(groups[0].items).toHaveLength(2);
    expect(searchChipLabel(groups[0].items[1], groups[0])).toContain(
      'other.Customers',
    );
  });
  it('builds exact typed destinations and rejects unsupported references', () => {
    const ref = { storeId: 'firestore', spaceID: 's', projectId: 'p' };
    const href = searchItemHref(ref, {
      ...table('DB'),
      kind: 'column',
      reference: {
        dbModelId: 'DB',
        schema: 'dbo',
        table: 'Customers',
        column: 'ID',
      },
    });
    expect(href).toContain('search-schema/DB');
    expect(href).toContain('column=ID');
    expect(
      searchItemHref(ref, { ...table('DB'), reference: {} }),
    ).toBeUndefined();
  });
  it('projects an allowlist without leaking definition fields', () => {
    const models = [
      {
        id: 'DB',
        schemas: [
          {
            id: 'dbo',
            tables: [
              {
                name: 'Customers',
                Columns: [{ name: 'ID', dbType: 'int', secret: 'password' }],
                sql: 'select secret',
              },
            ],
          },
        ],
      },
    ];
    const documents = schemaDocuments(models);
    expect(documents.map((item) => item.kind)).toEqual(['table', 'column']);
    expect(JSON.stringify(documents)).not.toMatch(
      /password|select secret|dbType/,
    );
  });
});

it.each(['Customers','..','team/'])('keeps actual tag %s separate from cross-kind name discovery in shared scope', name => {
  const ref={storeId:'firestore',spaceID:'S',projectId:'P'};
  const tag=searchItemHref(ref,{kind:'tag',id:name,name,tags:[],reference:{objectId:name}});
  const url=new URL(tag || '/', 'https://example.test');
  expect(url.pathname).not.toBe('/');
  expect(url.searchParams.get('tag') ?? decodeURIComponent(url.pathname.split('/').at(-1) || '')).toBe(name);
  expect(searchNameHref(ref,name)).toBe('/space/S/store/firestore/project/P/tag-discovery?name='+encodeURIComponent(name));
});
