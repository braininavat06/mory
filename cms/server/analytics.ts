import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { CmsError } from '../shared.ts';
import { DATABASE_ID, day, dayStart } from '../../analytics/protocol.ts';
import type { AnalyticsDB, Parameter, Query, Row } from '../../analytics/core.ts';
import { period, overview, pages, searches, visitorList, visitorDetail, effectivePages } from '../../analytics/queries.ts';

export class CloudflareAnalyticsDB implements AnalyticsDB {
 sizeBytes:number|null=null;
 constructor(private env:NodeJS.ProcessEnv=process.env,private request:typeof fetch=fetch){}
 private async execute(body:unknown) {
  const account=this.env.CLOUDFLARE_ACCOUNT_ID,token=this.env.CLOUDFLARE_D1_API_TOKEN;
  if(!account||!token)throw new CmsError(503,'방문 통계가 아직 연결되지 않았습니다. 서버의 Cloudflare D1 설정을 확인하세요.');
  if(!/^[a-f0-9]{32}$/i.test(account))throw new CmsError(503,'Cloudflare 계정 ID 설정을 확인하세요.');
  try {
   const response=await this.request(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DATABASE_ID}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   if(response.status===401||response.status===403)throw new CmsError(503,'방문 통계 API 권한을 확인하세요. D1 조회·수정 권한이 필요합니다.');
   const data=await response.json() as any;
   if(!response.ok||data.success!==true||!Array.isArray(data.result)||data.result.some((r:any)=>r.success===false))throw new Error('API');
   for(const r of data.result)if(Number.isFinite(r.meta?.size_after))this.sizeBytes=r.meta.size_after;
   return data.result;
  }catch(error){if(error instanceof CmsError)throw error;throw new CmsError(503,'방문 통계를 불러오지 못했습니다. 잠시 후 다시 시도하세요.');}
 }
 async query(sql:string,params:Parameter[]=[]):Promise<Row[]>{return(await this.execute({sql,params:params.map(p=>p===null?null:String(p))}))[0]?.results??[];}
 async batch(queries:Query[]){if(queries.length)await this.execute({batch:queries.map(q=>({sql:q.sql,params:(q.params??[]).map(p=>p===null?null:String(p))}))});}
}
export class AnalyticsService {
 private storageCache?:{at:number;value:any};
 private sync?:Promise<any>;
 constructor(public db:AnalyticsDB=new CloudflareAnalyticsDB(),private env:NodeJS.ProcessEnv=process.env,private request:typeof fetch=fetch){}
 async view(tab:string,input:Record<string,string|undefined>){
  let p;try{p=period(input);}catch(e){throw new CmsError(400,(e as Error).message);}
  if(tab==='overview')return overview(this.db,p);
  if(tab==='pages')return{period:p,pages:await pages(this.db,p),notFound:await this.db.query(`${effectivePages} SELECT pp.path,SUM(s.pageviews) total_pageviews,SUM(CASE WHEN s.date BETWEEN ? AND ? THEN s.pageviews ELSE 0 END) period_pageviews FROM effective s JOIN pages p ON p.id=s.page_id JOIN page_paths pp ON pp.id=s.path_id WHERE p.route_type='404' GROUP BY pp.path ORDER BY total_pageviews DESC LIMIT 50`,[p.from,p.to])};
  if(tab==='search')return{period:p,...await searches(this.db,p),googleConfigured:!!this.env.MORY_GSC_SERVICE_ACCOUNT_FILE};
  if(tab==='visitors') {const offset=this.offset(input.offset);const rows=await visitorList(this.db,input.query??'',offset);return{visitors:rows.slice(0,50),offset,next:rows.length>50?offset+50:null};}
  throw new CmsError(404,'통계 화면을 찾지 못했습니다.');
 }
 offset(value:string|undefined){const n=Number(value??0);if(!Number.isInteger(n)||n<0||n>1000000)throw new CmsError(400,'목록 위치를 확인하세요.');return n;}
 async visitor(id:number,offset=0){const data=await visitorDetail(this.db,id,offset);if(!data)throw new CmsError(404,'방문자를 찾지 못했습니다.');return{...data,timeline:data.timeline.slice(0,100),offset,next:data.timeline.length>100?offset+100:null};}
 async nickname(id:number,nickname:string){
  if(!Number.isInteger(id)||id<1||nickname.length>80||/[\u0000-\u001f]/.test(nickname))throw new CmsError(400,'별칭은 80자 이내로 입력하세요.');
  if(!(await this.db.query('SELECT id FROM visitors WHERE id=?',[id])).length)throw new CmsError(404,'방문자를 찾지 못했습니다.');
  await this.db.batch([{sql:"UPDATE visitors SET nickname=NULLIF(?,''),nickname_updated_at=? WHERE id=?",params:[nickname.trim(),Math.floor(Date.now()/1000),id]}]);
  return this.visitor(id);
 }
 async storage(){
  if(this.storageCache&&Date.now()-this.storageCache.at<300000)return this.storageCache.value;
  const row=(await this.db.query(`SELECT (SELECT COUNT(*) FROM pageviews) pageviews,(SELECT COUNT(*) FROM search_events) searches,(SELECT COUNT(*) FROM search_clicks) clicks,(SELECT COUNT(*) FROM visitors) visitors,(SELECT MIN(occurred_at) FROM pageviews) oldest_raw,(SELECT COUNT(*) FROM pageviews WHERE occurred_at>=?) recent_pageviews`,[Math.floor(Date.now()/1000)-30*86400]))[0];
  const sizes=await this.db.query('SELECT * FROM storage_daily WHERE date>=? ORDER BY date',[day(Math.floor(Date.now()/1000)-30*86400)]);
  const sizeBytes=this.db instanceof CloudflareAnalyticsDB?this.db.sizeBytes:null;
  const limitBytes=500*1000*1000,ratio=sizeBytes===null?null:sizeBytes/limitBytes;
  const thresholds=(this.env.MORY_ANALYTICS_STORAGE_THRESHOLDS??'0.7,0.8,0.9').split(',').map(Number);
  const valid=thresholds.length===3&&thresholds.every((x,i)=>Number.isFinite(x)&&x>0&&x<=1&&(i===0||x>thresholds[i-1]))?thresholds:[.7,.8,.9];
  const value={...row,sizeBytes,limitBytes,level:ratio===null?'unknown':ratio>=valid[2]?'strong':ratio>=valid[1]?'warning':ratio>=valid[0]?'notice':'normal',retentionDays:365,sizeGrowth30Days:sizes.length>1?sizes.at(-1)!.bytes-sizes[0].bytes:null};
  this.storageCache={at:Date.now(),value};return value;
 }
 syncGoogle(){
  if(this.sync)return this.sync;
  this.sync=this.google().finally(()=>{this.sync=undefined;});return this.sync;
 }
 private async google(){
  const file=this.env.MORY_GSC_SERVICE_ACCOUNT_FILE;
  if(!file)throw new CmsError(503,'Google Search Console 서비스 계정을 서버에 설정하세요.');
  try {
   const credentials=JSON.parse(await readFile(file,'utf8'));
   if(typeof credentials.client_email!=='string'||typeof credentials.private_key!=='string')throw Error('Credential');
   const now=Math.floor(Date.now()/1000),b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
   const unsigned=`${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/webmasters.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
   const signer=createSign('RSA-SHA256');signer.update(unsigned);const assertion=`${unsigned}.${signer.sign(credentials.private_key,'base64url')}`;
   const auth=await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000)});
   const token=await auth.json() as any;if(!auth.ok||!token.access_token)throw Error('Auth');
   const property=this.env.MORY_GSC_PROPERTY||'sc-domain:mory.place';
   // GSC dates are source-native Pacific calendar dates, kept as returned. The
   // final-data request and a 3-day lag avoid presenting incomplete recent rows.
   const sourceParts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now*1000).map(p=>[p.type,p.value]));
   const sourceToday=`${sourceParts.year}-${sourceParts.month}-${sourceParts.day}`;
   let imported=0;
   for(let back=30;back>=3;back--){
    const date=day(dayStart(sourceToday)-back*86400),rows:any[]=[];
    for(let offset=0;offset<=50000;offset+=25000){
     const response=await this.request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({startDate:date,endDate:date,dimensions:['date','query','page'],type:'web',dataState:'final',rowLimit:25000,startRow:offset}),signal:AbortSignal.timeout(20000)});
     const data=await response.json() as any;if(!response.ok||!Array.isArray(data.rows??[]))throw Error('Query');
     const chunk=data.rows??[];rows.push(...chunk);if(chunk.length<25000)break;if(offset===50000)throw Error('Incomplete');
    }
    await importGoogleDay(this.db,date,rows,now);imported+=rows.length;
   }
   return{imported,syncedAt:now};
  }catch(error){if(error instanceof CmsError)throw error;throw new CmsError(503,'Google 검색 통계를 동기화하지 못했습니다. 서비스 계정 권한과 Search Console 속성을 확인하세요. 이미 저장된 통계는 유지됩니다.');}
 }
}
export async function importGoogleDay(db:AnalyticsDB,date:string,rows:any[],now:number){
 const queries:Query[]=[{sql:"DELETE FROM external_search_stats WHERE source='google' AND date=?",params:[date]}];
 for(const row of rows){
  if(!Array.isArray(row.keys)||row.keys.length!==3||row.keys[0]!==date||typeof row.keys[1]!=='string'||row.keys[1].length>1000)throw Error('Google row');
  const url=new URL(row.keys[2]);if(!['https://mory.place','https://www.mory.place'].includes(url.origin))continue;
  if(![row.clicks,row.impressions,row.ctr,row.position].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0))throw Error('Google metrics');
  queries.push({sql:"INSERT INTO external_search_stats VALUES('google',?,?,?,?,?,?,?,?) ON CONFLICT(source,date,query,landing_page) DO UPDATE SET clicks=excluded.clicks,impressions=excluded.impressions,ctr=excluded.ctr,position=excluded.position,synced_at=excluded.synced_at",params:[date,row.keys[1],url.pathname,row.clicks,row.impressions,row.ctr,row.position,now]});
 }
 queries.push({sql:"INSERT INTO external_sync_days VALUES('google',?,?) ON CONFLICT(source,date) DO UPDATE SET synced_at=excluded.synced_at",params:[date,now]});
 // Cloudflare REST supports a transactional batch; no partial-day replacements.
 // Cap a sync day so a huge response cannot exceed request/batch resource limits.
 if(queries.length>1000)throw new CmsError(503,'하루의 Google 검색 통계가 안전한 동기화 크기를 초과했습니다. 기존 통계는 유지됩니다.');
 await db.batch(queries);
}
