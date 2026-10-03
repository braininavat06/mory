import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { build,transform } from 'esbuild';
import { schema,d1Adapter } from '../tests/helpers.ts';
import { collect, maintenance } from '../core.ts';
import { dayStart } from '../protocol.ts';
const dir=`runtime/analytics-measurement-${Date.now()}`;
const visitors=Number(process.env.MORY_ANALYTICS_MEASURE_VISITORS??2500);
if(!Number.isInteger(visitors)||visitors<1||visitors>10000)throw Error('Measurement visitors must be between 1 and 10000');
await mkdir(dir,{recursive:true});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local");}}',compatibilityDate:'2026-10-01',d1Databases:['ANALYTICS_DB','COST_DB'],d1Persist:join(process.cwd(),dir,'d1')}));
try {
 const db=await mf.getD1Database('ANALYTICS_DB');
 await db.exec(schema.split(/;\s*(?=CREATE|$)/).filter(s=>s.trim()).map(s=>s.trim().replace(/\n/g,' ')+';').join('\n'));
 const size=async()=>Number((await db.prepare('SELECT 1').all()).meta.size_after);
 const baseline=await size(),t=dayStart('2026-01-01');
 const seed=[];
 for(let i=1;i<=visitors;i++)seed.push(db.prepare('INSERT INTO visitors(id,visitor_key,first_seen_at,last_seen_at) VALUES(?,?,?,?)').bind(i,createHash('sha256').update(`visitor-${i}`).digest('hex').slice(0,40),t+(i-1)*360,t+(i-1)*360));
 for(let i=1;i<=83;i++){
  const id=i>3?`01K6F4J0M000000000000${String(i).padStart(5,'0')}`:null,path=i===1?'/':i===2?'/about/':i===3?'/writing/':`/writing/sample-article-${i}/`,route=i===1?'home':i===2?'about':i===3?'other':'post';
  seed.push(db.prepare('INSERT INTO pages VALUES(?,?,?,?,?,?,?)').bind(i,id?`post:${id}`:`${route}:${path}`,route,id,path,t,t));seed.push(db.prepare('INSERT INTO page_paths VALUES(?,?,?)').bind(i,i,path));
 }
 for(const [i,host,source] of [[1,'','direct'],[2,'google.com','search'],[3,'naver.com','search'],[4,'chatgpt.com','external'],[5,'mory.place','internal']] as const)seed.push(db.prepare('INSERT INTO referrers VALUES(?,?,?)').bind(i,host,source));
 for(let i=0;i<seed.length;i+=100)await db.batch(seed.slice(i,i+100));
 let rowsWritten=0,rowsRead=0;
 for(let i=0;i<10000;i+=100){
  const queries=[];
  for(let j=i;j<i+100;j++){
   const visitor=Math.floor(j/3)%visitors+1,bucket=j%100,page=bucket<25?1:bucket<30?2:bucket<45?3:4+j%80,time=t+j*120;
   queries.push(db.prepare(`INSERT INTO pageviews(occurred_at,visitor_id,page_id,path_id,referrer_id,country,device,browser,os,is_visit) SELECT ?,id,?,?,?,?,?,?,?,CASE WHEN last_view_at IS NULL OR ?-last_view_at>=1800 THEN 1 ELSE 0 END FROM visitors WHERE id=?`).bind(time,page,page,j%3===0?j%4+1:5,visitor%10===0?'US':'KR',visitor%4===0?'desktop':'mobile',visitor%5===0?'safari':'chromium',visitor%5===0?'ios':'android',time,visitor));
   if(j%12===0)queries.push(db.prepare('INSERT INTO search_events(occurred_at,visitor_id,page_id,query,normalized_query,result_count) VALUES(?,?,?,?,?,?)').bind(time,visitor,page,`검색어 ${j%40}`,`검색어 ${j%40}`,j%7));
   if(j%35===0)queries.push(db.prepare('INSERT INTO search_clicks(occurred_at,visitor_id,page_id,normalized_query,rank) VALUES(?,?,?,?,?)').bind(time+1,visitor,page,`검색어 ${j%40}`,j%3+1));
  }
  for(const result of await db.batch(queries)){rowsWritten+=result.meta.rows_written??0;rowsRead+=result.meta.rows_read??0;}
 }
 const rawSize=await size();
 let rollupWritten=0,rollupRead=0;
 const rollupDB={query:async(sql:string,params:any[]=[])=>{const result=await db.prepare(sql).bind(...params).all();rollupRead+=result.meta.rows_read??0;return result.results as any[];},batch:async(queries:any[])=>{for(const result of await db.batch(queries.map(q=>db.prepare(q.sql).bind(...(q.params??[]))))){rollupWritten+=result.meta.rows_written??0;rollupRead+=result.meta.rows_read??0;}}};
 for(let i=0;i<3;i++)await maintenance(rollupDB,t+20*86400);
 const finalSize=await size();
 const bytePerPV=(finalSize-baseline)/10000;
 const old=execFileSync('git',['show','HEAD:src/scripts/search.ts'],{encoding:'utf8'});
 const baselineJS=(await transform(old,{loader:'ts',minify:true,target:'es2022'})).code;
 const current=(await build({entryPoints:['src/scripts/search.ts'],bundle:true,write:false,minify:true,format:'esm',platform:'browser',target:'es2022'})).outputFiles[0].contents;
 const cost=await mf.getD1Database('COST_DB');await cost.exec(schema.split(/;\s*(?=CREATE|$)/).filter(s=>s.trim()).map(s=>s.trim().replace(/\n/g,' ')+';').join('\n'));
 let ingestWritten=0,ingestRead=0;
 const costDB={query:d1Adapter(cost).query,batch:async(queries:any[])=>{for(const result of await cost.batch(queries.map(q=>cost.prepare(q.sql).bind(...(q.params??[]))))){ingestWritten+=result.meta.rows_written??0;ingestRead+=result.meta.rows_read??0;}}};
 const event={type:'pageview' as const,visitor:'12345678-1234-4234-8234-123456789abc',path:'/',route:'home'};
 await collect(costDB,event,'cost-visitor','Android Mobile Chrome','KR',t);ingestWritten=0;ingestRead=0;
 for(let i=1;i<=20;i++)await collect(costDB,event,'cost-visitor','Android Mobile Chrome','KR',t+i*60);
 const expired=await cost.prepare('DELETE FROM pageviews WHERE id IN (SELECT id FROM pageviews ORDER BY occurred_at LIMIT 1000)').run();
 const report={baselineBytes:baseline,rawBytes:rawSize,withRollupBytes:finalSize,growthBytes:finalSize-baseline,pageviews:10000,visitors,searchEvents:834,searchClicks:286,bytesPerPV:bytePerPV,pvPerDayAt70Percent:Math.floor(350000000/bytePerPV/365),pvPerDayAt500MB:Math.floor(500000000/bytePerPV/365),syntheticRowsRead:rowsRead,syntheticRowsWritten:rowsWritten,rollupRowsRead:rollupRead,rollupRowsWritten:rollupWritten,rowsReadPerIngestPV:ingestRead/20,rowsWrittenPerIngestPV:ingestWritten/20,rowsWrittenPerExpiredPV:(expired.meta.rows_written??0)/21,searchBundleBeforeBytes:Buffer.byteLength(baselineJS),searchBundleAfterBytes:current.byteLength,publicJSAddedBytes:current.byteLength-Buffer.byteLength(baselineJS),publicJSAddedGzipBytes:gzipSync(current).length-gzipSync(baselineJS).length};
 await writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await mf.dispose();}
