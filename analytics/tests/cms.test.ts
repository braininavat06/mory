import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { AnalyticsService,CloudflareAnalyticsDB,importGoogleDay } from '../../cms/server/analytics.ts';
import { sqlite,pageview } from './helpers.ts';
import { collect } from '../core.ts';
test('missing D1 config and Cloudflare auth/API failures degrade without credential exposure',async()=>{
 await assert.rejects(new CloudflareAnalyticsDB({}).query('SELECT 1'),/아직 연결되지/);
 for(const status of [401,403,500]){
  const db=new CloudflareAnalyticsDB({CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_D1_API_TOKEN:'test-secret'},async()=>new Response(JSON.stringify({success:false,errors:[{message:'test-secret'}]}),{status}));
  await assert.rejects(db.query('SELECT 1'),(e:any)=>!e.message.includes('test-secret')&&e.status===503);
 }
});
test('REST bound queries/batch stay server-only, official size metadata and storage warning',async()=>{
 const requests:any[]=[];
 const db=new CloudflareAnalyticsDB({CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_D1_API_TOKEN:'test-secret'},async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));return Response.json({success:true,result:[{success:true,meta:{size_after:460000000},results:[{visitors:2,pageviews:7}]}]});});
 await db.query('SELECT ?',['x']);await db.batch([{sql:'UPDATE visitors SET nickname=? WHERE id=?',params:['친구A',1]}]);assert.deepEqual(requests[0],{sql:'SELECT ?',params:['x']});assert.equal(requests[1].batch[0].params[0],'친구A');
 const storage=await new AnalyticsService(db).storage();assert.equal(storage.level,'strong');assert.equal(storage.sizeBytes,460000000);assert.ok(!JSON.stringify(storage).includes('test-secret'));
});
test('Google day sync replaces idempotently, keeps only path and never links visitors',async()=>{
 const{db,sql}=sqlite(),rows=[{keys:['2026-10-01','한글 검색','https://mory.place/writing/foo/?secret=1#part'],clicks:5,impressions:10,ctr:.5,position:3}];
 await importGoogleDay(db,'2026-10-01',rows,1);await importGoogleDay(db,'2026-10-01',rows,2);const row=sql.prepare<any[], any>('SELECT * FROM external_search_stats').get() as any;
 assert.equal(row.landing_page,'/writing/foo/');assert.equal(row.clicks,5);assert.equal(row.synced_at,2);assert.ok(!('visitor_id'in row));assert.equal(sql.prepare<any[], any>('SELECT COUNT(*) n FROM visitors').get()!.n,0);
 await assert.rejects(importGoogleDay(db,'2026-10-01',[{...rows[0],clicks:NaN}],3));assert.equal(sql.prepare<any[], any>('SELECT clicks FROM external_search_stats').get()!.clicks,5);sql.close();
});
test('Google service account mock outbound sync and missing config; no private inbound service',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mory-google-'));const{db,sql}=sqlite();
 try{
  const{privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const file=join(dir,'service-account.json');await writeFile(file,JSON.stringify({client_email:'test@example.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'})}));
  let tokenRequests=0,dataRequests=0;
  const request:typeof fetch=async(url,init)=>{
   if(String(url)==='https://oauth2.googleapis.com/token'){tokenRequests++;assert.ok(String(init?.body).includes('assertion'));return Response.json({access_token:'private-test-token'});}
   dataRequests++;assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer private-test-token');const input=JSON.parse(String(init?.body));assert.deepEqual(input.dimensions,['date','query','page']);assert.equal(input.dataState,'final');return Response.json({rows:[{keys:[input.startDate,'test','https://mory.place/'],clicks:1,impressions:2,ctr:.5,position:1}]});
  };
  const service=new AnalyticsService(db,{MORY_GSC_SERVICE_ACCOUNT_FILE:file},request);const[result,duplicate]=await Promise.all([service.syncGoogle(),service.syncGoogle()]);assert.deepEqual(result,duplicate);assert.equal(tokenRequests,1);assert.equal(dataRequests,28);assert.equal(result.imported,28);
  await assert.rejects(new AnalyticsService(db,{}).syncGoogle(),/サービス|서비스 계정/);
 }finally{sql.close();await rm(dir,{recursive:true,force:true});}
});
test('CMS visitor pagination/search/nickname/timeline/empty/range validation use shared SQL',async()=>{
 const{db,sql}=sqlite();const service=new AnalyticsService(db,{}),now=Math.floor(Date.now()/1000);await collect(db,pageview,'a','',null,now);
 await service.nickname(1,'친구A');const list=await service.view('visitors',{query:'친구',offset:'0'});assert.ok('visitors' in list);assert.equal(list.visitors!.length,1);assert.equal((await service.visitor(1)).timeline.length,1);
 await service.nickname(1,'');const empty=await service.view('visitors',{query:'친구'});assert.ok('visitors' in empty);assert.equal(empty.visitors!.length,0);
 await assert.rejects(service.view('overview',{period:'custom',from:'2026-02-30',to:'2026-10-03'}),/날짜/);await assert.rejects(service.visitor(999),/찾지/);assert.throws(()=>service.offset('-1'));
 sql.close();
});
