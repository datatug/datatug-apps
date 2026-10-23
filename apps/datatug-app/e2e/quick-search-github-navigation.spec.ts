import { expect, test } from './helpers/demodb-guard';

/** Real short GitHub routes, guard, boot script, overview submit and pinned file reader. HTTP alone is controlled. */
test('GitHub overview query survives navigation/reload and typed Checks open safe metadata',async({page},testInfo)=>{
  const sha='a'.repeat(40),base='/project/github.com/acme/search-navigation/demo-project-1/-/';
  const files:Record<string,unknown>={
    'demo-project-1/datatug-project.json':{id:'demo-project-1',title:'Search navigation project',access:'public',boards:[],entities:[],environments:[],tags:{customers:1}},
    'demo-project-1/checks/check-a.json':{id:'check-a',title:'Customer freshness',tags:['customers'],steps:[{query:'PRIVATE SQL SHOULD NOT RENDER'}],description:'PRIVATE DESCRIPTION'},
    'demo-project-1/checks/check-b.json':{id:'check-b',title:'Order freshness',tags:['orders']},
  };
  const documents=[{kind:'check',id:'check-a',name:'Customer freshness',tags:['customers'],reference:{objectId:'check-a'}},{kind:'check',id:'check-b',name:'Order freshness',tags:['orders'],reference:{objectId:'check-b'}}];
  const requests:string[]=[],queries:string[]=[];let writes=0,previewCalls=0;
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'};
  await page.route(url=>['api.github.com','raw.githubusercontent.com','cdn.jsdelivr.net'].includes(url.hostname),async route=>{
    const url=new URL(route.request().url());requests.push(url.href);
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    if(url.hostname==='api.github.com'){
      if(url.pathname==='/repos/acme/search-navigation')return route.fulfill({json:{default_branch:'main'},headers:cors});
      if(url.pathname.includes('/commits/'))return route.fulfill({body:sha,headers:cors});
      if(url.pathname.includes('/git/trees/')){
        const dirs=new Set<string>();for(const file of Object.keys(files)){const parts=file.split('/');for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join('/'));}
        return route.fulfill({json:{sha:'b'.repeat(40),truncated:false,tree:[...[...dirs].map(path=>({path,type:'tree'})),...Object.keys(files).map(path=>({path,type:'blob'}))]},headers:cors});
      }
    }
    const path=url.hostname==='raw.githubusercontent.com'?url.pathname.split('/').slice(4).join('/'):'';
    if(path in files)return route.fulfill({json:files[path],headers:cors});
    return route.fulfill({status:404,headers:cors});
  });
  await page.route('**/v0/datatug/project/quick-search/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    if(path.endsWith('/status'))return route.fulfill({json:{state:'ready',eligible:true,audience:'public',canManage:false,provider:'Typesense',documentCount:2,supportsMetadataPreview:false},headers:cors});
    if(path.endsWith('/search')){
      const body=route.request().postDataJSON();if(!body.q?.trim())return route.fulfill({status:400,json:{error:'invalid_request'},headers:cors});queries.push(body.q);
      return route.fulfill({json:{items:documents,itemCount:2,tags:['customers','orders']},headers:cors});
    }
    if(path.endsWith('/preview'))previewCalls++;else writes++;
    return route.fulfill({status:403,json:{error:'denied'},headers:cors});
  });
  await page.goto(base+'overview');
  const input=page.getByRole('combobox',{name:'Quick Search',exact:true});
  await expect(input).toBeVisible();await input.fill('customer');await input.press('Enter');
  await expect(page).toHaveURL(/\/quick-search\?q=customer$/);
  const active=page.locator('sneat-datatug-quick-search:not(.ion-page-hidden)');
  await expect(active.getByRole('searchbox',{name:'Search names, titles, tags and descriptions',exact:true})).toHaveValue('customer');
  await expect.poll(()=>queries.at(-1)).toBe('customer');
  await page.reload();await expect(page).toHaveURL(/\/quick-search\?q=customer$/);
  await expect(active.getByRole('searchbox',{name:'Search names, titles, tags and descriptions',exact:true})).toHaveValue('customer');
  // The ready index adds Checks, which the in-memory inventory does not list; only the matching one is shown.
  const checks=active.locator('ion-card.results-card ion-item',{hasText:'Customer freshness'});
  await expect(checks).toHaveCount(1);
  await checks.first().click();
  await expect(page).toHaveURL(/detailKind=check&objectId=check-a/);
  const detail=page.locator('sneat-datatug-quick-search[data-search-view=check]:not(.ion-page-hidden)');
  await expect(detail.getByRole('heading',{name:'Customer freshness',exact:true})).toBeVisible();
  await expect(detail.getByText('Check metadata · Read-only names and tags')).toBeVisible();
  await expect(detail.getByText('Tags: customers',{exact:true})).toBeVisible();
  await expect(detail.getByText('PRIVATE SQL SHOULD NOT RENDER')).toHaveCount(0);await expect(detail.getByText('PRIVATE DESCRIPTION')).toHaveCount(0);
  await expect(detail.getByRole('button',{name:'Index settings',exact:true})).toHaveCount(0);await expect(detail.getByRole('button',{name:/Run/})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await page.screenshot({path:testInfo.outputPath('check-metadata-mobile.png'),fullPage:true});
  await page.goBack();await expect(checks).toHaveCount(1);
  await page.goto(base+'overview');await input.fill('order');await input.press('Enter');
  await expect(page).toHaveURL(/\/quick-search\?q=order$/);await expect.poll(()=>queries.at(-1)).toBe('order');
  await active.locator('ion-card.results-card ion-item',{hasText:'Order freshness'}).click();
  await expect(detail.getByRole('heading',{name:'Order freshness',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(previewCalls).toBe(0);expect(writes).toBe(0);
  const checkReads=requests.filter(url=>url.includes('/checks/'));
  expect(checkReads.length).toBeGreaterThan(0);expect(checkReads.every(url=>url.includes('/'+sha+'/'))).toBe(true);
});
