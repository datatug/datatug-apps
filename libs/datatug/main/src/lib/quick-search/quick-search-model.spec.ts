import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { checkMetadataTarget } from './quick-search-model';
import {
  groupSearchItems,
  SearchDocument,
  searchChipLabel,
  searchItemHref,
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

describe('typed Check metadata destinations',()=>{
  const item:SearchDocument={kind:'check',id:'check-a',name:'Check A',tags:[],reference:{objectId:'check-a'}};
  it('keeps Firestore and the exact default demo on their existing Check page',()=>{
    expect(searchItemHref({storeId:'firestore',spaceID:'s',projectId:'p'},item)).toContain('/checks/check-a');
    expect(searchItemHref(DEMO_PROJECT_REF,item)).toContain('/checks/check-a');
  });
  it('routes other GitHub checks to a closed metadata query and preserves qualifiers',()=>{
    const href=searchItemHref({storeId:'github.com',projectId:'repo@owner@folder',projectApi:'cloud',branch:'feature'},item) as string;
    expect(href).toContain('/quick-search?');
    const url=new URL(href,'https://datatug.app');
    expect(url.searchParams.get('detailKind')).toBe('check');expect(url.searchParams.get('objectId')).toBe('check-a');
    expect(url.searchParams.get('projectApi')).toBe('cloud');expect(url.searchParams.get('branch')).toBe('feature');
    expect(searchItemHref({...DEMO_PROJECT_REF,branch:'feature'},item)).toContain('detailKind=check');
  });
  it.each(['?detailKind=table&objectId=a','?detailKind=check','?objectId=a','?detailKind=check&objectId=../a','?detailKind=check&detailKind=check&objectId=a'])('rejects malformed metadata selector %s',query=>{
    const params=new URLSearchParams(query);expect(checkMetadataTarget(params)).toEqual({kind:'invalid'});
  });
});
