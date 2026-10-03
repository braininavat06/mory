import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { schema,d1Adapter,pageview,visitorA,postId } from './helpers.ts';
import { collect,visitorKey,rollup } from '../core.ts';
import { day,dayStart } from '../protocol.ts';
import { AnalyticsService } from '../../cms/server/analytics.ts';
test('real Worker + local D1 migration, privacy, validation, concurrent visits and rollup',async t=>{
 const bundle=await build({entryPoints:['analytics/worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2023'});
 const secret='local-test-secret-with-more-than-32-characters';
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-01',d1Databases:['ANALYTICS_DB'],bindings:{ANALYTICS_HMAC_SECRET:secret},ratelimits:{EVENT_LIMITER:{namespace_id:'4000901',simple:{limit:60,period:60}}}}));
 try {
  const db=await mf.getD1Database('ANALYTICS_DB');
  const statements=schema.split(/;\s*(?=CREATE|$)/).filter(s=>s.trim()).map(s=>s.trim().replace(/\n/g,' ')+';');
  await db.exec(statements.join('\n'));
  const adapter=d1Adapter(db);
  const request=(value:any,headers:Record<string,string>={},extra:any={})=>mf.dispatchFetch('https://analytics.mory.place/event',{method:'POST',headers:{Origin:'https://mory.place','Content-Type':'application/json','User-Agent':'Mozilla Android Mobile Chrome/140',...headers},body:typeof value==='string'?value:JSON.stringify(value),...extra});
  await t.test('first pageview persists coarse metadata without IP/UA/UUID/referrer query',async()=>{
   const response=await request({...pageview,referrer:'www.google.com'},{'cf-connecting-ip':'203.0.113.10'},{cf:{country:'KR'}});assert.equal(response.status,204);assert.equal(await response.text(),'');
   const rows=await adapter.query('SELECT * FROM pageviews');assert.equal(rows.length,1);assert.equal(rows[0].device,'mobile');assert.equal(rows[0].browser,'chromium');assert.equal(rows[0].os,'android');assert.equal(rows[0].country,'KR');
   const visitor=(await adapter.query('SELECT * FROM visitors'))[0];assert.equal(visitor.visitor_key,await visitorKey(secret,visitorA));assert.ok(!JSON.stringify(rows).includes('203.0.113.10'));assert.ok(!JSON.stringify(visitor).includes(visitorA));
   const columns=await adapter.query('PRAGMA table_info(pageviews)');assert.ok(!columns.some(r=>/ip|user_agent|uuid|session/.test(r.name)));
  });
  await t.test('nickname change/remove is private and independent of raw logs',async()=>{
   const service=new AnalyticsService(adapter);const saved=await service.nickname(1,'나');assert.equal(saved.visitor.nickname,'나');
   const response=await request(pageview);assert.equal(await response.text(),'');assert.ok(![...response.headers.values()].join().includes('나'));
   assert.equal((await service.nickname(1,'친구A')).visitor.nickname,'친구A');assert.equal((await service.nickname(1,'')).visitor.nickname,null);
  });
  await t.test('invalid origin/method/JSON/extra fields/path/query rejected',async()=>{
   assert.equal((await request(pageview,{Origin:'https://evil.test'})).status,403);
   assert.equal((await mf.dispatchFetch('https://analytics.mory.place/event',{headers:{Origin:'https://mory.place'}})).status,405);
   assert.equal((await request('{bad')).status,400);assert.equal((await request({...pageview,ip:'secret'})).status,400);assert.equal((await request({...pageview,path:'/foo#fragment'})).status,400);assert.equal((await request({...pageview,referrer:'google.com?q=private'})).status,400);
   assert.equal((await request('x'.repeat(2049))).status,413);
   assert.equal((await request(pageview,{'Content-Type':'text/plain'})).status,415);
   assert.equal((await request(pageview,{Origin:'https://www.mory.place'})).status,204);
   assert.equal((await mf.dispatchFetch('https://analytics.mory.place/private',{headers:{Origin:'https://mory.place'}})).status,404);
  });
  await t.test('bots dropped; country does not leak location; 404 stored',async()=>{
   const before=(await adapter.query('SELECT COUNT(*) n FROM pageviews'))[0].n;
   assert.equal((await request(pageview,{'User-Agent':'Googlebot'})).status,204);assert.equal((await adapter.query('SELECT COUNT(*) n FROM pageviews'))[0].n,before);
   assert.equal((await request({...pageview,path:'/missing/',route:'404'})).status,204);assert.equal((await adapter.query("SELECT route_type FROM pages WHERE canonical_path='/missing/'"))[0].route_type,'404');
  });
  await t.test('real D1 concurrent 30-minute visits increments once, not twice',async()=>{
   const now=dayStart('2026-10-03')+40000,key='concurrent-test';
   await collect(adapter,pageview,key,'',null,now);
   await Promise.all(Array.from({length:8},()=>collect(adapter,pageview,key,'',null,now+1800)));
   const visitor=(await adapter.query('SELECT * FROM visitors WHERE visitor_key=?',[key]))[0];assert.equal(visitor.total_pageviews,9);assert.equal(visitor.total_visits,2);
  });
  await t.test('real D1 deduped search/ranked clicks/atomic daily aggregate',async()=>{
   const now=dayStart('2026-10-02')+40000;
   await collect(adapter,pageview,'search','',null,now);
   await Promise.all(Array.from({length:4},()=>collect(adapter,{...pageview,type:'search',query:'obsidian',count:0},'search','',null,now)));
   await collect(adapter,{...pageview,type:'search_click',query:'obsidian',rank:2,route:'post',content:postId,path:'/writing/obsidian/'},'search','',null,now+1);
   assert.equal((await adapter.query("SELECT COUNT(*) n FROM search_events WHERE normalized_query='obsidian'"))[0].n,1);
   await rollup(adapter,day(now),now+86400);await rollup(adapter,day(now),now+86400);
   assert.equal((await adapter.query("SELECT * FROM internal_search_stats WHERE normalized_query='obsidian'"))[0].total_clicks,1);
  });
  await t.test('edge rate limit bounds repeated requests without persisting the IP',async()=>{
   const statuses=await Promise.all(Array.from({length:62},()=>request(pageview,{'cf-connecting-ip':'198.51.100.77'}).then(r=>r.status)));
   assert.ok(statuses.includes(429));assert.ok(statuses.filter(s=>s===204).length<=60);
   assert.ok(!JSON.stringify(await adapter.query('SELECT * FROM visitors')).includes('198.51.100.77'));
  });
  await t.test('D1 failure is isolated as empty 503, no secrets',async()=>{
   await db.prepare('DROP TRIGGER pv_summary').run();await db.prepare('DROP TABLE pageviews').run();
   const response=await request(pageview);assert.equal(response.status,503);assert.equal(await response.text(),'');
  });
 }finally{await mf.dispose();}
});
