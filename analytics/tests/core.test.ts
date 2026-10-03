import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlite,visitorA,visitorB,pageview,postId } from './helpers.ts';
import { collect,maintenance,rollup,visitorKey } from '../core.ts';
import { parseEvent,referrer,families,dayStart,day } from '../protocol.ts';
import { overview,pages,period,searches,visitorDetail,effectivePages } from '../queries.ts';
const now=dayStart('2026-10-03')+36000,secret='test-only-secret-not-a-production-key';
test('HMAC is stable, case-normalized, isolated by secret and cannot reveal UUID',async()=>{
 const a=await visitorKey(secret,visitorA);assert.equal(a.length,40);assert.equal(a,await visitorKey(secret,visitorA.toUpperCase()));assert.notEqual(a,await visitorKey(secret,visitorB));assert.notEqual(a,await visitorKey(secret+'2',visitorA));assert.ok(!a.includes(visitorA));
});
test('first/repeat/second visitor and exact 30 minute boundary',async()=>{
 const{db,sql}=sqlite();for(const t of [0,1799,3599])await collect(db,pageview,'a','',null,now+t);
 await collect(db,pageview,'b','',null,now+3600);
 const a=sql.prepare<any[], any>('SELECT * FROM visitors WHERE visitor_key=?').get('a') as any;
 assert.equal(a.total_pageviews,3);assert.equal(a.total_visits,2);assert.equal(a.first_seen_at,now);assert.equal(a.last_seen_at,now+3599);assert.equal(sql.prepare<any[], any>('SELECT COUNT(*) n FROM visitors').get()!.n,2);sql.close();
});
test('post ULID continues totals across slug change while raw historical path remains',async()=>{
 const{db,sql}=sqlite();await collect(db,{...pageview,route:'post',content:postId,path:'/writing/old/'},'a','',null,now);await collect(db,{...pageview,route:'post',content:postId,path:'/writing/new/'},'a','',null,now+1);
 const rows=await pages(db,period({period:'all'},now));assert.equal(rows.length,1);assert.equal(rows[0].total_pageviews,2);assert.equal(rows[0].canonical_path,'/writing/new/');
 const detail=await visitorDetail(db,1,0,now+2);assert.deepEqual(detail!.timeline.map(r=>r.path),['/writing/new/','/writing/old/']);sql.close();
});
for(const [host,source] of [['','direct'],['www.mory.place','internal'],['www.google.com','search'],['search.naver.com','search'],['m.search.naver.com','search'],['google.co.kr','search'],['google.com.evil','external'],['www.bing.com','search'],['chatgpt.com','external'],['reddit.com','social'],['github.com','external']])test(`referrer ${host||'direct'} → ${source}`,()=>assert.equal(referrer(host).source,source));
test('strict payload rejects unapproved fields, full referrer, fragments, invalid identity, oversized path/query',()=>{
 assert.ok(parseEvent(pageview));for(const patch of [{ip:'1.2.3.4'},{ua:'raw'},{session:'x'},{type:'other'},{visitor:'bad'},{path:'/foo#secret'},{path:'/foo?private=1'},{path:'//evil.com'},{path:'/../foo'},{path:'/'+ 'a'.repeat(513)},{referrer:'https://google.com/?q=private'},{content:postId},{type:'search',query:'x',count:0},{type:'search',query:'a'.repeat(201),count:0}])assert.equal(parseEvent({...pageview,...patch}),null);
 assert.ok(parseEvent({...pageview,type:'search',query:'한글 검색',count:0}));assert.ok(parseEvent({...pageview,route:'404',path:'/missing/'}));
});
test('UA only yields coarse families and country is separate',()=>{
 assert.deepEqual(families('Mozilla Android Mobile Chrome/140'),{device:'mobile',browser:'chromium',os:'android'});assert.deepEqual(families('iPad Safari/605'),{device:'tablet',browser:'safari',os:'ios'});assert.deepEqual(families('Windows Firefox/143'),{device:'desktop',browser:'firefox',os:'windows'});assert.equal(families('Macintosh Safari').os,'macos');assert.equal(families('Linux Chrome').os,'linux');assert.equal(families('').device,'unknown');
});
test('search dedupe, whitespace aggregate normalization, zero results and ranked click',async()=>{
 const{db,sql}=sqlite();await collect(db,pageview,'a','',null,now);
 const event={...pageview,type:'search' as const,query:'  한글   검색  ',count:0};await collect(db,event,'a','',null,now);await collect(db,{...event,query:'한글 검색'},'a','',null,now+30);await collect(db,event,'a','',null,now+61);
 await collect(db,{...pageview,type:'search_click',query:'한글 검색',rank:2,route:'post',content:postId,path:'/writing/foo/'},'a','',null,now+62);
 const data=await searches(db,period({period:'all'},now));assert.equal(data.internal[0].total_searches,2);assert.equal(data.internal[0].zero_result_count,2);assert.equal(data.internal[0].total_clicks,1);assert.equal(data.raw[0].query,event.query);
 await rollup(db,'2026-10-03',now+86400);assert.equal((await searches(db,period({period:'all'},now+86400))).internal[0].total_clicks,1);sql.close();
});
test('daily rollup is idempotent, exact unique/new/returning and totals survive 366-day expiry',async()=>{
 const{db,sql}=sqlite();const t=dayStart('2025-01-01')+36000;
 await collect(db,pageview,'a','Android Mobile Chrome','KR',t);await collect(db,pageview,'a','Android Mobile Chrome','KR',t+1);await collect(db,pageview,'b','Macintosh Safari','US',t+2);await collect(db,pageview,'a','',null,t+86400);
 await collect(db,{...pageview,type:'search',query:'test',count:0},'a','',null,t+3);
 await collect(db,{...pageview,type:'search_click',query:'test',rank:1},'a','',null,t+4);
 await rollup(db,'2025-01-01',t+86400);await rollup(db,'2025-01-01',t+86400);
 const stat=sql.prepare<any[], any>('SELECT * FROM daily_stats').get() as any;assert.equal(stat.pageviews,3);assert.equal(stat.unique_visitors,2);assert.equal(stat.new_visitors,2);assert.equal(stat.returning_visitors,0);assert.equal(stat.visits,2);
 await db.batch([{sql:'UPDATE visitors SET nickname=? WHERE visitor_key=?',params:['친구A','a']}]);
 await maintenance(db,t+367*86400);
 for(const table of ['pageviews','search_events','search_clicks'])assert.equal(sql.prepare<any[], any>(`SELECT COUNT(*) n FROM ${table}`).get()!.n,0);
 const a=sql.prepare<any[], any>('SELECT * FROM visitors WHERE visitor_key=?').get('a') as any;assert.equal(a.nickname,'친구A');assert.equal(a.total_pageviews,3);assert.equal(a.total_visits,2);
 assert.equal(sql.prepare<any[], any>('SELECT SUM(total_pageviews) n FROM page_stats').get()!.n,4);assert.equal(sql.prepare<any[], any>('SELECT SUM(total_pageviews) n FROM referrer_stats').get()!.n,4);assert.equal(sql.prepare<any[], any>('SELECT total_searches FROM internal_search_stats').get()!.total_searches,1);
 const p=period({period:'all'},t+367*86400),view=await overview(db,p,t+367*86400);assert.equal(view.totals.pageviews,4);assert.equal(view.totals.visitors,2);assert.equal(view.trend[1].returning_visitors,1);assert.equal((await visitorDetail(db,a.id,0,t+367*86400))!.timeline.length,0);
 await rollup(db,'2025-01-01',t+368*86400);assert.equal(sql.prepare<any[], any>('SELECT SUM(total_pageviews) n FROM page_stats').get()!.n,4);sql.close();
});
test('365-day edge is retained, bounded cleanup never removes unrolled data',async()=>{
 const{db,sql}=sqlite();await collect(db,pageview,'a','',null,now-365*86400);await collect(db,pageview,'b','',null,now-366*86400);
 // Fail rollup: maintenance must stop before deletion.
 const failing={...db,batch:async()=>{throw Error('crash');}};await assert.rejects(maintenance(failing,now));assert.equal(sql.prepare<any[], any>('SELECT COUNT(*) n FROM pageviews').get()!.n,2);
 await maintenance(db,now);assert.equal(sql.prepare<any[], any>('SELECT COUNT(*) n FROM pageviews').get()!.n,1);assert.equal(sql.prepare<any[], any>('SELECT total_pageviews FROM visitors WHERE visitor_key=?').get('b')!.total_pageviews,1);sql.close();
});
test('rollup batch crash rolls back and retries without lost/double aggregates; late day event invalidates rollup',async()=>{
 const{db,sql}=sqlite();await collect(db,pageview,'a','',null,now);
 const failing={...db,batch:async(q:any[])=>db.batch([...q,{sql:'INSERT INTO nonexistent VALUES(1)'}])};await assert.rejects(rollup(failing,'2026-10-03',now+86400));assert.equal(sql.prepare<any[], any>('SELECT COUNT(*) n FROM daily_stats').get()!.n,0);assert.equal(sql.prepare<any[], any>('SELECT COUNT(*) n FROM pending_days').get()!.n,1);
 await rollup(db,'2026-10-03',now+86400);await collect(db,pageview,'a','',null,now+1);assert.equal((await overview(db,period({period:'all'},now+86400),now+86400)).totals.pageviews,2);await rollup(db,'2026-10-03',now+86400);assert.equal(sql.prepare<any[], any>('SELECT pageviews FROM daily_stats').get()!.pageviews,2);sql.close();
});
test('whole-history queries read aggregates plus pending days, not full raw history; historical UV is honest',async()=>{
 const{db,sql}=sqlite();await collect(db,pageview,'a','',null,now);await rollup(db,day(now),now+86400);
 const queries:string[]=[];const spy={...db,query:async(s:string,p:any[]=[])=>{queries.push(s);return db.query(s,p);}};
 await overview(spy,period({period:'all'},now+86400),now+86400);assert.ok(queries.some(s=>s.includes('daily_stats')));assert.ok(queries.filter(s=>s.includes('FROM pageviews')).every(s=>s.includes('pending_days')));
 const old=await overview(db,period({period:'custom',from:'2024-01-01',to:'2026-10-03'},now),now);assert.equal(old.exactUnique,false);assert.equal(old.totals.visitors,null);
 assert.ok(sql.prepare<any[], any>(`EXPLAIN QUERY PLAN ${effectivePages} SELECT * FROM effective`).all().some((r:any)=>r.detail.includes('pv_time')));sql.close();
});
test('out-of-order concurrent arrivals preserve earliest/latest visitor times and page identities',async()=>{
 const{db,sql}=sqlite();await collect(db,{...pageview,path:'/about/',route:'about'},'a','',null,now+1);await collect(db,pageview,'a','',null,now);
 const row=(await db.query('SELECT * FROM visitors'))[0];assert.equal(row.first_view_at,now);assert.equal(row.last_view_at,now+1);assert.equal(row.first_seen_at,now);assert.equal(row.total_visits,1);assert.notEqual(row.first_page_id,row.last_page_id);sql.close();
});
test('stale concurrent rollup cannot overwrite finalized aggregates after raw cleanup',async()=>{
 const{db,sql}=sqlite();await collect(db,pageview,'a','',null,now);
 const delayed={...db,batch:async(queries:any[])=>{
  await rollup(db,day(now),now+86400);
  await db.batch([{sql:'DELETE FROM pageviews'}]);
  await db.batch(queries);
 }};
 await rollup(delayed,day(now),now+86400);assert.equal((await db.query('SELECT total_pageviews FROM page_stats'))[0].total_pageviews,1);assert.equal((await db.query('SELECT pageviews FROM daily_stats'))[0].pageviews,1);sql.close();
});
