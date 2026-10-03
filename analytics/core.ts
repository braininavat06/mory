import { day, dayStart, normalizeQuery, referrer, families, RETENTION_DAYS } from './protocol.ts';
import type { AnalyticsEvent } from './protocol.ts';
export type Parameter = string | number | null;
export type Row = Record<string, any>;
export interface Query { sql: string; params?: Parameter[] }
export interface AnalyticsDB { query(sql: string, params?: Parameter[]): Promise<Row[]>; batch(queries: Query[]): Promise<void> }
const q = (sql: string, ...params: Parameter[]): Query => ({sql,params});
export async function visitorKey(secret: string, uuid: string) {
 const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes = new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(uuid.toLowerCase())));
 return Array.from(bytes.slice(0,20),b=>b.toString(16).padStart(2,'0')).join(''); // 160 bits; never persist the browser UUID.
}
export async function collect(db: AnalyticsDB, event: AnalyticsEvent, key: string, ua: string, country: string | null, now = Math.floor(Date.now()/1000)) {
 const identity = event.route === 'post' ? `post:${event.content}` : `${event.route}:${event.path}`;
 const queries = [
  q('INSERT INTO visitors(visitor_key,first_seen_at,last_seen_at) VALUES(?,?,?) ON CONFLICT(visitor_key) DO UPDATE SET first_seen_at=excluded.first_seen_at WHERE excluded.first_seen_at<first_seen_at',key,now,now),
  q('INSERT INTO pages(identity,route_type,content_id,canonical_path,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?) ON CONFLICT(identity) DO UPDATE SET canonical_path=CASE WHEN excluded.last_seen_at>=last_seen_at THEN excluded.canonical_path ELSE canonical_path END,last_seen_at=MAX(last_seen_at,excluded.last_seen_at)',identity,event.route,event.content??null,event.path,now,now),
  q('INSERT OR IGNORE INTO page_paths(page_id,path) SELECT id,? FROM pages WHERE identity=?',event.path,identity),
 ];
 if (event.type === 'pageview') {
  const r=referrer(event.referrer),f=families(ua);
  queries.push(q('INSERT OR IGNORE INTO referrers(host,source_type) VALUES(?,?)',r.host,r.source));
  // The INSERT reads last_view_at and its trigger updates it in the same atomic
  // D1 batch. Concurrent requests cannot both increment a 30-minute visit.
  queries.push(q(`INSERT INTO pageviews(occurred_at,visitor_id,page_id,path_id,referrer_id,country,device,browser,os,is_visit)
   SELECT ?,v.id,p.id,pp.id,r.id,?,?,?,?,CASE WHEN v.last_view_at IS NULL OR ?-v.last_view_at>=1800 THEN 1 ELSE 0 END
   FROM visitors v,pages p,page_paths pp,referrers r WHERE v.visitor_key=? AND p.identity=? AND pp.page_id=p.id AND pp.path=? AND r.host=? AND r.source_type=?`,now,country,f.device,f.browser,f.os,now,key,identity,event.path,r.host,r.source));
 } else if(event.type==='search') {
  queries.push(q(`INSERT INTO search_events(occurred_at,visitor_id,page_id,query,normalized_query,result_count)
   SELECT ?,v.id,p.id,?,?,? FROM visitors v,pages p WHERE v.visitor_key=? AND p.identity=? AND NOT EXISTS(SELECT 1 FROM search_events WHERE visitor_id=v.id AND occurred_at>=?-60 AND normalized_query=?)`,now,event.query!,normalizeQuery(event.query!),event.count!,key,identity,now,normalizeQuery(event.query!)));
 } else {
  queries.push(q('INSERT INTO search_clicks(occurred_at,visitor_id,page_id,normalized_query,rank) SELECT ?,v.id,p.id,?,? FROM visitors v,pages p WHERE v.visitor_key=? AND p.identity=?',now,normalizeQuery(event.query!),event.rank!,key,identity));
 }
 await db.batch(queries);
}
export async function rollup(db: AnalyticsDB, date: string, now = Math.floor(Date.now()/1000)) {
 const start=dayStart(date),end=start+86400;
 if(end>now) return; // Today remains live; never freeze a partial day.
 if(!(await db.query('SELECT date FROM pending_days WHERE date=?',[date])).length)return;
 const queries: Query[]=[];
 for(const table of ['daily_page_stats','daily_referrer_stats','daily_breakdowns','daily_search_stats']) queries.push(q(`DELETE FROM ${table} WHERE date=?`,date));
 queries.push(q(`INSERT INTO daily_page_stats SELECT page_id,?,path_id,COUNT(*),SUM(is_visit),MIN(occurred_at),MAX(occurred_at) FROM pageviews WHERE occurred_at>=? AND occurred_at<? GROUP BY page_id,path_id`,date,start,end));
 queries.push(q(`INSERT INTO daily_referrer_stats SELECT referrer_id,?,COUNT(*),SUM(is_visit),MIN(occurred_at),MAX(occurred_at) FROM pageviews WHERE occurred_at>=? AND occurred_at<? GROUP BY referrer_id`,date,start,end));
 for(const dimension of ['country','device','browser','os']) queries.push(q(`INSERT INTO daily_breakdowns SELECT ?,?,COALESCE(${dimension},'unknown'),COUNT(*) FROM pageviews WHERE occurred_at>=? AND occurred_at<? GROUP BY ${dimension}`,date,dimension,start,end));
 queries.push(q(`INSERT INTO daily_search_stats SELECT normalized_query,?,SUM(searches),SUM(zeroes),SUM(clicks),MIN(t),MAX(t) FROM (
  SELECT normalized_query,1 searches,result_count=0 zeroes,0 clicks,occurred_at t FROM search_events WHERE occurred_at>=? AND occurred_at<?
  UNION ALL SELECT normalized_query,0,0,1,occurred_at FROM search_clicks WHERE occurred_at>=? AND occurred_at<?) GROUP BY normalized_query`,date,start,end,start,end));
 queries.push(q(`INSERT INTO daily_stats SELECT ?,COUNT(*),COUNT(DISTINCT pv.visitor_id),COALESCE(SUM(is_visit),0),COUNT(DISTINCT CASE WHEN v.first_view_at>=? AND v.first_view_at<? THEN v.id END),COUNT(DISTINCT CASE WHEN v.first_view_at<? THEN v.id END),? FROM pageviews pv JOIN visitors v ON v.id=pv.visitor_id WHERE occurred_at>=? AND occurred_at<?
  ON CONFLICT(date) DO UPDATE SET pageviews=excluded.pageviews,unique_visitors=excluded.unique_visitors,visits=excluded.visits,new_visitors=excluded.new_visitors,returning_visitors=excluded.returning_visitors,rolled_at=excluded.rolled_at`,date,start,end,start,now,start,end));
 // Guard inside the transaction too: a concurrent cron may have finalized and
 // expired this day between the initial read and this batch. A stale batch must
 // never replace permanent statistics with the remaining (or empty) raw rows.
 const pending='EXISTS(SELECT 1 FROM pending_days WHERE date=?)';
 for(const query of queries){
  if(query.sql.startsWith('DELETE'))query.sql+=` AND ${pending}`;
  else if(query.sql.includes('GROUP BY'))query.sql+=` HAVING ${pending}`;
  else query.sql=query.sql.replace('ON CONFLICT(date)',`HAVING ${pending} ON CONFLICT(date)`);
  query.params=[...(query.params??[]),date];
 }
 queries.push(q('DELETE FROM pending_days WHERE date=?',date));
 // Replacement of all day aggregates + pending marker is one transaction.
 // A late server event re-adds the pending day, and a retry replaces, not adds.
 await db.batch(queries);
}
export async function maintenance(db: AnalyticsDB, now = Math.floor(Date.now()/1000)) {
 const today=day(now);
 const pending=await db.query('SELECT date FROM pending_days WHERE date<? ORDER BY date LIMIT 7',[today]);
 for(const row of pending) await rollup(db,row.date,now);
 const cutoff=now-RETENTION_DAYS*86400;
 for(const table of ['search_clicks','search_events','pageviews']) {
  // Limit each cron's deletion work. Never delete an unrolled or newly dirty day.
  await db.batch([q(`DELETE FROM ${table} WHERE id IN (SELECT e.id FROM ${table} e WHERE e.occurred_at<? AND EXISTS(SELECT 1 FROM daily_stats d WHERE d.date=date(e.occurred_at,'unixepoch','+9 hours')) AND NOT EXISTS(SELECT 1 FROM pending_days p WHERE p.date=date(e.occurred_at,'unixepoch','+9 hours')) ORDER BY e.occurred_at LIMIT 1000)`,cutoff)]);
 }
}
