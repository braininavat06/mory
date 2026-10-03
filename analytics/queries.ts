import type { AnalyticsDB } from './core.ts';
import { day, dayStart, RETENTION_DAYS } from './protocol.ts';
export interface Period { from: string; to: string; all: boolean }
export function period(input:Record<string,string|undefined>,now=Math.floor(Date.now()/1000)):Period {
 const today=day(now),preset=input.period??'30';
 if(preset==='all')return{from:'1970-01-01',to:today,all:true};
 if(preset==='custom') {
  const from=input.from??'',to=input.to??'';
  if(![from,to].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(dayStart(d))&&day(dayStart(d))===d)||from>to||to>today)throw Error('날짜 범위를 확인하세요.');
  return{from,to,all:false};
 }
 if(!['1','7','30','365'].includes(preset))throw Error('지원하지 않는 기간입니다.');
 return{from:day(dayStart(today)-(Number(preset)-1)*86400),to:today,all:false};
}
// Permanent day aggregates are overlaid only with pending (not-yet-final) days.
// Whole-history views do not scan the retained raw history on every request.
const live = (table:string) => `${table}.occurred_at >= COALESCE((SELECT unixepoch(MIN(date)||'T00:00:00+09:00') FROM pending_days),9223372036854775807) AND date(${table}.occurred_at,'unixepoch','+9 hours') IN (SELECT date FROM pending_days)`;
export const effectiveDaily=`WITH effective AS (
 SELECT date,pageviews,unique_visitors,visits,new_visitors,returning_visitors FROM daily_stats WHERE date NOT IN (SELECT date FROM pending_days)
 UNION ALL SELECT date(pv.occurred_at,'unixepoch','+9 hours'),COUNT(*),COUNT(DISTINCT pv.visitor_id),SUM(pv.is_visit),COUNT(DISTINCT CASE WHEN date(v.first_view_at,'unixepoch','+9 hours')=date(pv.occurred_at,'unixepoch','+9 hours') THEN v.id END),COUNT(DISTINCT CASE WHEN date(v.first_view_at,'unixepoch','+9 hours')<date(pv.occurred_at,'unixepoch','+9 hours') THEN v.id END)
 FROM pageviews pv JOIN visitors v ON v.id=pv.visitor_id WHERE ${live('pv')} GROUP BY date(pv.occurred_at,'unixepoch','+9 hours'))`;
export const effectivePages=`WITH effective AS (
 SELECT page_id,date,path_id,pageviews,landings,first_seen_at,last_seen_at FROM daily_page_stats WHERE date NOT IN (SELECT date FROM pending_days)
 UNION ALL SELECT page_id,date(occurred_at,'unixepoch','+9 hours'),path_id,COUNT(*),SUM(is_visit),MIN(occurred_at),MAX(occurred_at) FROM pageviews WHERE ${live('pageviews')} GROUP BY page_id,date(occurred_at,'unixepoch','+9 hours'),path_id)`;
export const effectiveReferrers=`WITH effective AS (
 SELECT referrer_id,date,pageviews,landings FROM daily_referrer_stats WHERE date NOT IN (SELECT date FROM pending_days)
 UNION ALL SELECT referrer_id,date(occurred_at,'unixepoch','+9 hours'),COUNT(*),SUM(is_visit) FROM pageviews WHERE ${live('pageviews')} GROUP BY referrer_id,date(occurred_at,'unixepoch','+9 hours'))`;
export const effectiveSearch=`WITH effective AS (
 SELECT normalized_query,date,searches,zero_result_count,clicks,last_seen_at FROM daily_search_stats WHERE date NOT IN (SELECT date FROM pending_days)
 UNION ALL SELECT normalized_query,date(t,'unixepoch','+9 hours'),SUM(searches),SUM(zeroes),SUM(clicks),MAX(t) FROM (
 SELECT normalized_query,occurred_at t,1 searches,result_count=0 zeroes,0 clicks FROM search_events WHERE ${live('search_events')}
 UNION ALL SELECT normalized_query,occurred_at,0,0,1 FROM search_clicks WHERE ${live('search_clicks')}) GROUP BY normalized_query,date(t,'unixepoch','+9 hours'))`;
export async function pages(db:AnalyticsDB,p:Period) {
 return db.query(`${effectivePages} SELECT p.*,SUM(e.pageviews) total_pageviews,SUM(CASE WHEN e.date BETWEEN ? AND ? THEN e.pageviews ELSE 0 END) period_pageviews,SUM(e.landings) landings,MIN(e.first_seen_at) first_view_at,MAX(e.last_seen_at) last_view_at FROM effective e JOIN pages p ON p.id=e.page_id GROUP BY p.id ORDER BY period_pageviews DESC,p.id LIMIT 100`,[p.from,p.to]);
}
export async function overview(db:AnalyticsDB,p:Period,now=Math.floor(Date.now()/1000)) {
 const trend=await db.query(`${effectiveDaily} SELECT * FROM effective WHERE date BETWEEN ? AND ? ORDER BY date`,[p.from,p.to]);
 const totals=trend.reduce<{pageviews:number;visits:number;new_visitors:number}>((a,r)=>({pageviews:a.pageviews+r.pageviews,visits:a.visits+r.visits,new_visitors:a.new_visitors+r.new_visitors}),{pageviews:0,visits:0,new_visitors:0});
 // Exact arbitrary historical-range unique users cannot be recovered from day
 // counts once raw presence expires. Be explicit instead of summing daily UV.
 const exact=p.all||dayStart(p.from)>=now-RETENTION_DAYS*86400;
 const unique=exact?await db.query(p.all?'SELECT COUNT(*) visitors,SUM(total_visits>1) returning_count FROM visitors WHERE total_pageviews>0':`SELECT COUNT(DISTINCT pv.visitor_id) visitors,COUNT(DISTINCT CASE WHEN v.first_view_at<? THEN v.id END) returning_count FROM pageviews pv JOIN visitors v ON v.id=pv.visitor_id WHERE occurred_at>=? AND occurred_at<?`,p.all?[]:[dayStart(p.from),dayStart(p.from),dayStart(p.to)+86400]):[];
 const topPages=await pages(db,p);
 const sources=await db.query(`${effectiveReferrers} SELECT r.host,r.source_type,SUM(e.pageviews) pageviews,SUM(e.landings) landings FROM effective e JOIN referrers r ON r.id=e.referrer_id WHERE e.date BETWEEN ? AND ? GROUP BY r.id ORDER BY landings DESC,pageviews DESC LIMIT 20`,[p.from,p.to]);
 const breakdowns=[];
 for(const dimension of ['country','device','browser','os']) breakdowns.push(...await db.query(`WITH effective AS(SELECT date,dimension,value,pageviews FROM daily_breakdowns WHERE date NOT IN (SELECT date FROM pending_days) UNION ALL SELECT date(occurred_at,'unixepoch','+9 hours'),?,COALESCE(${dimension},'unknown'),COUNT(*) FROM pageviews WHERE ${live('pageviews')} GROUP BY date(occurred_at,'unixepoch','+9 hours'),${dimension}) SELECT dimension,value,SUM(pageviews) pageviews FROM effective WHERE date BETWEEN ? AND ? AND dimension=? GROUP BY value ORDER BY pageviews DESC LIMIT 15`,[dimension,p.from,p.to,dimension]));
 return{period:p,totals:{...totals,visitors:unique[0]?.visitors??null,returning_visitors:unique[0]?.returning_count??null},trend,topPages:topPages.slice(0,10),sources,breakdowns,exactUnique:exact};
}
export async function visitorList(db:AnalyticsDB,query:string,offset:number) {
 const term=query.trim().slice(0,80).replace(/[\\%_]/g,'\\$&');
 return db.query("SELECT * FROM visitors WHERE (COALESCE(nickname,'') LIKE ? ESCAPE '\\' OR visitor_key LIKE ? ESCAPE '\\') ORDER BY last_seen_at DESC,id DESC LIMIT 51 OFFSET ?",[`%${term}%`,`${term}%`,offset]);
}
export async function visitorDetail(db:AnalyticsDB,id:number,offset:number,now=Math.floor(Date.now()/1000)) {
 const visitor=(await db.query('SELECT * FROM visitors WHERE id=?',[id]))[0];if(!visitor)return null;
 const cutoff=now-RETENTION_DAYS*86400;
 const timeline=await db.query(`SELECT * FROM (
  SELECT pv.id,'pageview' type,pv.occurred_at,pp.path,r.host,r.source_type,NULL query,NULL result_count,NULL rank,pv.is_visit FROM pageviews pv JOIN page_paths pp ON pp.id=pv.path_id JOIN referrers r ON r.id=pv.referrer_id WHERE visitor_id=? AND occurred_at>=?
  UNION ALL SELECT s.id,'search',s.occurred_at,p.canonical_path,NULL,NULL,s.query,s.result_count,NULL,NULL FROM search_events s JOIN pages p ON p.id=s.page_id WHERE visitor_id=? AND occurred_at>=?
  UNION ALL SELECT s.id,'search_click',s.occurred_at,p.canonical_path,NULL,NULL,s.normalized_query,NULL,s.rank,NULL FROM search_clicks s JOIN pages p ON p.id=s.page_id WHERE visitor_id=? AND occurred_at>=?) ORDER BY occurred_at DESC,type,id DESC LIMIT 101 OFFSET ?`,[id,cutoff,id,cutoff,id,cutoff,offset]);
 return{visitor,timeline,retentionDays:RETENTION_DAYS};
}
export async function searches(db:AnalyticsDB,p:Period,now=Math.floor(Date.now()/1000)) {
 const internal=await db.query(`${effectiveSearch} SELECT normalized_query,SUM(searches) total_searches,SUM(zero_result_count) zero_result_count,SUM(clicks) total_clicks,MAX(last_seen_at) last_seen_at FROM effective WHERE date BETWEEN ? AND ? GROUP BY normalized_query ORDER BY total_searches DESC LIMIT 100`,[p.from,p.to]);
 const raw=await db.query('SELECT s.occurred_at,s.query,s.result_count,v.id visitor_id,COALESCE(v.nickname,substr(v.visitor_key,1,8)) visitor FROM search_events s JOIN visitors v ON v.id=s.visitor_id WHERE occurred_at>=? AND occurred_at<? ORDER BY occurred_at DESC LIMIT 50',[Math.max(dayStart(p.from),now-RETENTION_DAYS*86400),dayStart(p.to)+86400]);
 const external=await db.query('SELECT query,landing_page,SUM(clicks) clicks,SUM(impressions) impressions,CASE WHEN SUM(impressions)>0 THEN SUM(clicks)/SUM(impressions) ELSE 0 END ctr,CASE WHEN SUM(impressions)>0 THEN SUM(position*impressions)/SUM(impressions) ELSE 0 END position FROM external_search_stats WHERE date BETWEEN ? AND ? GROUP BY query,landing_page ORDER BY clicks DESC LIMIT 100',[p.from,p.to]);
 const sync=(await db.query("SELECT MAX(synced_at) at FROM external_sync_days WHERE source='google'"))[0];
 return{internal,raw,external,lastSync:sync?.at??null};
}
