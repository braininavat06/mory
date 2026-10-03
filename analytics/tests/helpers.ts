import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import type { AnalyticsDB, Parameter, Query } from '../core.ts';
export const schema=readFileSync(new URL('../migrations/0001_analytics.sql',import.meta.url),'utf8');
export function sqlite(path=':memory:') {
 const sql=new Database(path);sql.pragma('foreign_keys=ON');sql.exec(schema);
 const db:AnalyticsDB={query:async(text,params=[])=>sql.prepare(text).all(...params) as any[],batch:async queries=>{sql.transaction(()=>{for(const q of queries)sql.prepare(q.sql).run(...(q.params??[]));})();}};
 return{sql,db};
}
export const visitorA='12345678-1234-4234-8234-123456789abc',visitorB='22345678-1234-4234-8234-123456789abc';
export const postId='01K6F4J0M00000000000000001';
export const pageview={type:'pageview' as const,visitor:visitorA,path:'/',route:'home'};
export function d1Adapter(db:any):AnalyticsDB{return{query:async(sql,params:Parameter[]=[])=> (await db.prepare(sql).bind(...params).all()).results,batch:async(queries:Query[])=>{await db.batch(queries.map(q=>db.prepare(q.sql).bind(...(q.params??[]))));}};}
