import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {visitorA,postId} from './helpers.ts';
const bundle=(await build({entryPoints:['src/scripts/analytics.ts'],bundle:true,write:false,format:'iife',globalName:'MoryAnalytics',platform:'browser',target:'es2022'})).outputFiles[0].text;
function client(host='mory.place',failure=false,saved?:string){
 const events:any[]=[],storage=new Map(saved?[['mory_visitor_id',saved]]:[]),timers=new Map<number,{at:number;callback:()=>void}>(),listeners=new Map<string,Function>();let now=0,id=0;
 const scope:any={location:{protocol:host==='localhost'?'http:':'https:',hostname:host,pathname:'/writing/foo/'},document:{body:{dataset:{analytics:'on',analyticsRoute:'post',analyticsContent:postId}},referrer:'https://www.google.com/search?q=private#fragment'},localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},crypto:{randomUUID:()=>visitorA},Blob,URL,addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),Date:class extends Date{static now(){return now;}},navigator:{sendBeacon:(_url:string,blob:Blob)=>{events.push(blob);return!failure;}},fetch:()=>Promise.reject(Error('outage')),setTimeout:(callback:()=>void,delay:number)=>{timers.set(++id,{at:now+delay,callback});return id;},clearTimeout:(key:number)=>timers.delete(key)};
 runInNewContext(bundle,scope);
 return{events,storage,pageShow:(persisted:boolean)=>listeners.get('pageshow')?.({persisted}),log:scope.MoryAnalytics.searchLogging(),tick:(duration:number)=>{now+=duration;for(const [key,timer]of timers)if(timer.at<=now){timers.delete(key);timer.callback();}}};
}
test('production beacon is non-blocking, strips referrer query/fragment and reuses valid identity',async()=>{
 const c=client();assert.equal(c.events.length,1);const event=JSON.parse(await c.events[0].text());assert.equal(event.referrer,'www.google.com');assert.equal(event.path,'/writing/foo/');assert.equal(event.content,postId);assert.equal(event.visitor,visitorA);assert.equal(c.storage.get('mory_visitor_id'),visitorA);
 const repeat=client('mory.place',false,visitorA);assert.equal(JSON.parse(await repeat.events[0].text()).visitor,visitorA);
 assert.equal(JSON.parse(await client('mory.place',false,'x'.repeat(36)).events[0].text()).visitor,visitorA);
});
for(const host of ['localhost','127.0.0.1','preview.mory.place','mory.mau-hamal.ts.net'])test(`analytics disabled on ${host}`,()=>{const c=client(host);c.log.searched('query',1);c.tick(1000);assert.equal(c.events.length,0);assert.equal(c.storage.size,0);});
test('confirmed Pagefind searches debounce, suppress short/repeated queries and flush before ranked click',async()=>{
 const c=client();c.log.searched('x',0);c.tick(1000);assert.equal(c.events.length,1);
 c.log.searched('first query',7);c.tick(500);c.log.searched('second query',0);c.tick(799);assert.equal(c.events.length,1);c.tick(1);assert.equal(c.events.length,2);
 c.log.searched(' second  query ',0);c.tick(1000);assert.equal(c.events.length,2);
 c.log.searched('third query',2);c.log.clicked('third query',2,'/writing/clicked/',postId);assert.equal(c.events.length,4);
 const search=JSON.parse(await c.events[2].text()),click=JSON.parse(await c.events[3].text());assert.equal(search.type,'search');assert.equal(click.type,'search_click');assert.equal(click.rank,2);assert.equal(click.content,postId);c.tick(1000);assert.equal(c.events.length,4);
});
test('Worker/network failure has no retry storm and does not escape client',async()=>{
 const c=client('mory.place',true);c.log.searched('query',0);c.tick(1000);await new Promise(resolve=>setImmediate(resolve));assert.equal(c.events.length,2);c.tick(100000);assert.equal(c.events.length,2);
});
test('bfcache restoration records another view as internal without double counting first pageshow',async()=>{
 const c=client();c.pageShow(false);assert.equal(c.events.length,1);c.pageShow(true);assert.equal(c.events.length,2);assert.equal(JSON.parse(await c.events[1].text()).referrer,'mory.place');
});
