import { collect, maintenance, visitorKey } from '../core.ts';
import type { AnalyticsDB } from '../core.ts';
import { MAX_BYTES, parseEvent } from '../protocol.ts';
export interface Env { ANALYTICS_DB: D1Database; ANALYTICS_HMAC_SECRET: string; EVENT_LIMITER: RateLimit }
export function binding(db: D1Database): AnalyticsDB {
 return { query: async (sql,params=[]) => (await db.prepare(sql).bind(...params).all()).results as any[], batch: async queries => { await db.batch(queries.map(q=>db.prepare(q.sql).bind(...(q.params??[])))); } };
}
export async function fetchEvent(request: Request, env: Env): Promise<Response> {
 const origin=request.headers.get('Origin')??'';
 const allowed=['https://mory.place','https://www.mory.place'].includes(origin);
 const headers:Record<string,string>={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
 if(allowed) Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'3600'});
 const response=(status:number)=>new Response(null,{status,headers});
 if(new URL(request.url).pathname!=='/event') return response(404);
 if(!allowed) return response(403);
 if(request.method==='OPTIONS')return response(204);
 if(request.method!=='POST')return response(405);
 const ua=request.headers.get('user-agent')??'';
 if(/bot\b|crawler|spider|headless|lighthouse|preview|slurp/i.test(ua)||(request as any).cf?.botManagement?.verifiedBot) return response(204);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return response(415);
 if(Number(request.headers.get('content-length'))>MAX_BYTES)return response(413);
 try {
  if(!env.ANALYTICS_HMAC_SECRET || env.ANALYTICS_HMAC_SECRET.length<32)return response(503);
  // The IP is used transiently for an edge rate-limit bucket, never as visitor
  // identity and never stored/logged. HMAC prevents the limiter retaining raw IP.
  const ip=request.headers.get('cf-connecting-ip');
  if(ip && env.EVENT_LIMITER && !(await env.EVENT_LIMITER.limit({key:await visitorKey(env.ANALYTICS_HMAC_SECRET,`rate:${ip}`)})).success)return response(429);
  const reader=request.body?.getReader(); if(!reader)return response(400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();return response(413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{return response(400);}
  const event=parseEvent(value);if(!event)return response(400);
  const cf=(request as any).cf;
  const country=typeof cf?.country==='string'&&/^[A-Z]{2}$/.test(cf.country)?cf.country:null;
  await collect(binding(env.ANALYTICS_DB),event,await visitorKey(env.ANALYTICS_HMAC_SECRET,event.visitor),ua,country);
  return response(204);
 }catch{ return response(503); } // Do not log request, UUID, IP, UA, or D1 payload.
}
export default {
 fetch:fetchEvent,
 async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil((async()=>{
  await maintenance(binding(env.ANALYTICS_DB));
  const now=Math.floor(Date.now()/1000),date=new Date((now+32400)*1000).toISOString().slice(0,10);
  if(!(await env.ANALYTICS_DB.prepare('SELECT date FROM storage_daily WHERE date=?').bind(date).first())){
   const result=await env.ANALYTICS_DB.prepare('SELECT 1').all();
   const bytes=result.meta?.size_after;
   if(Number.isFinite(bytes))await env.ANALYTICS_DB.prepare('INSERT OR IGNORE INTO storage_daily VALUES(?,?)').bind(date,bytes!).run();
  }
 })().catch(()=>{console.warn('Analytics maintenance failed; next cron will retry.');}));}
} satisfies ExportedHandler<Env>;
