import { QuickSearchApiService } from './quick-search-api.service';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProjectService } from '../services/project/project.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { QueriesService } from '../queries/queries.service';
import {
  QuickSearchSnapshotService,
  queryDocuments,
} from './quick-search-snapshot.service';

describe('Quick Search actual metadata snapshot', () => {
  it('reads current folder schema columns wrapper and uploads only projected names', async () => {
    const directory = vi.fn((project: string, path: string) =>
      of(
        (
          {
            dbmodels: ['Chinook'],
            'dbmodels/Chinook': ['dbo'],
            'dbmodels/Chinook/dbo': ['tables'],
            'dbmodels/Chinook/dbo/tables': ['Customers'],
            'dbmodels/Chinook/dbo/views': [],
          } as Record<string, string[]>
        )[path]?.map((name) => ({ name, type: 'dir' })) || [],
      ),
    );
    const raw = vi.fn(() =>
      of({
        columns: [{ name: 'ID', dbType: 'secret-type' }],
        tags: ['customers'],
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: QuickSearchApiService, useValue: {} },
        {
          provide: ProjectService,
          useValue: {
            watchProjectSummary: () =>
              of({
                id: 'demo',
                title: 'Demo',
                access: 'public',
                tags: { customers: 1 },
              }),
          },
        },
        {
          provide: QueriesService,
          useValue: { getQueriesFolder: () => of({ id: '~', items: [] }) },
        },
        { provide: ProjectQueryApiService, useValue: {} },
        {
          provide: GithubProjectReaderService,
          useValue: {
            readInfo: () => of({ commit: 'a'.repeat(40) }),
            visitEpoch: () => '0.0',
            listDirectory: directory,
            getRawJson: raw,
          },
        },
      ],
    });
    const snapshot = await TestBed.inject(QuickSearchSnapshotService).preview({
      storeId: 'github.com',
      projectId: 'repo@owner@',
      branch: 'main',
    });
    expect(snapshot.documents.map((item) => item.kind)).toEqual([
      'tag',
      'table',
      'column',
    ]);
    expect(
      snapshot.documents.find((item) => item.kind === 'column')?.name,
    ).toBe('ID');
    expect(JSON.stringify(snapshot)).not.toContain('secret-type');
    expect(
      directory.mock.calls.every((call) => call[0] === 'repo@owner@@main'),
    ).toBe(true);
    expect(
      snapshot.sourceCoverage.find((item) => item.kind === 'server')?.status,
    ).toBe('unavailable');
  });
  it('retains assigned tags and exact qualified query identity without SQL', () => {
    const documents = queryDocuments({
      id: '~',
      folders: [
        {
          id: 'customers',
          items: [
            {
              id: 'spend',
              title: 'Spend',
              request: { queryType: 'SQL', text: 'private SQL' },
              tags: [' customer ', 'customer'],
            } as never,
          ],
        },
      ],
    });
    expect(documents[0]).toEqual({
      kind: 'query',
      id: 'customers/spend',
      name: 'Spend',
      tags: ['customer'],
      reference: { objectId: 'spend', folder: 'customers' },
    });
    expect(JSON.stringify(documents)).not.toContain('private SQL');
  });
});

describe('public object metadata authority',()=>{
  function setup(missingBoard=false, rawOverride?:unknown) {
    const getBoard=vi.fn((_project:string,id:string,options:unknown)=>{
      expect(options).toEqual({requireExisting:true});
      if(missingBoard && id==='second') throw new Error('missing');
      return of({id,title:'Actual '+id,tags:['customers'],sql:'private-sql',rows:['private-row']});
    });
    TestBed.configureTestingModule({providers:[
      {provide:QuickSearchApiService,useValue:{}},
      {provide:ProjectService,useValue:{watchProjectSummary:()=>of({id:'p',boards:[{id:'first',title:'Brief'},{id:'second'}],entities:[{id:'customer',title:'Brief entity'}],environments:[{id:'dev',title:'Brief env'}]})}},
      {provide:ProjectQueryApiService,useValue:{}},
      {provide:QueriesService,useValue:{getQueriesFolder:()=>of({id:'~',items:[]})}},
      {provide:GithubProjectReaderService,useValue:{getBoard,listDirectory:()=>of([]),readInfo:()=>of({commit:'a'.repeat(40)}),visitEpoch:()=> '0',getRawJson:(_project:string,path:string)=>of(rawOverride !== undefined ? rawOverride : {id:path.startsWith('entities/')?'customer':'dev',title:'Full source title',tags:['real-tag'],secrets:'private-secret'})}},
    ]});
    return TestBed.inject(QuickSearchSnapshotService).preview({storeId:'github.com',projectId:'repo@owner@'});
  }
  it('reads actual title and assigned tags missing from brief inventory without copying definitions',async()=>{
    const snapshot=await setup();
    expect(snapshot.documents.find(d=>d.kind==='dashboard')).toMatchObject({id:'first',name:'Actual first',tags:['customers']});
    expect(snapshot.documents.find(d=>d.kind==='entity')).toMatchObject({name:'Full source title',tags:['real-tag']});
    expect(snapshot.documents.find(d=>d.kind==='environment')).toMatchObject({name:'Full source title',tags:['real-tag']});
    for(const excluded of ['Brief','private-sql','private-row','private-secret']) expect(JSON.stringify(snapshot)).not.toContain(excluded);
  });
  it('marks the entire category unavailable when one full object read fails',async()=>{
    const snapshot=await setup(true);
    expect(snapshot.documents.some(d=>d.kind==='dashboard')).toBe(false);
    expect(snapshot.sourceCoverage.find(c=>c.kind==='dashboard')).toMatchObject({status:'unavailable',count:0});
  });
  it.each([[],{id:'customer',tags:null}])('rejects malformed full metadata without changing successful categories (%j)',async raw=>{
    const snapshot=await setup(false,raw);
    expect(snapshot.documents.filter(d=>d.kind==='dashboard')).toHaveLength(2);
    expect(snapshot.documents.some(d=>d.kind==='entity'||d.kind==='environment')).toBe(false);
    expect(snapshot.sourceCoverage.find(c=>c.kind==='entity')).toMatchObject({status:'unavailable',count:0});
  });

});
