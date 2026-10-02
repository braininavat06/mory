import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Autosave } from '../client/autosave.ts';
import type { Clock } from '../client/autosave.ts';
import type { Draft, Payload } from '../shared.ts';
function fixture() {
 let now=0, next=0;const timers=new Map<number,{at:number;fn:()=>void}>();
 const clock:Clock={now:()=>now,set:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:now+delay});return id;},clear:id=>{timers.delete(id);}};
 const tick=async(ms:number)=>{const end=now+ms;while(true){const item=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;now=item[1].at;timers.delete(item[0]);item[1].fn();await new Promise(r=>setImmediate(r));}now=end;};
 const storage=new Map<string,string>();const local={keys:()=>[...storage.keys()],getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>{storage.set(k,v);},removeItem:(k:string)=>{storage.delete(k);}};
 const draft:Draft={kind:'post',id:'test',path:'fixture.md',published:null,base_hash:null,ever_published:false,updated_at:'2026-10-01T12:00:00+09:00',status:'초안',key:'post:test',value:{data:{title:'初'},body:''},revision:20,saved_at:'2026-10-01T12:00:00+09:00'};
 let saved=structuredClone(draft), calls:Payload[]=[];
 const engine=new Autosave(draft,async(revision,value)=>{assert.equal(revision,saved.revision);calls.push(structuredClone(value));saved={...saved,revision:revision+1,value,saved_at:'2026-10-01T15:42:00+09:00'};return saved;},()=>{},local,clock);
 return {engine,tick,calls,clock,local,storage};
}
test('autosave debounces two seconds, never uses browser time as saved_at and removes emergency only after success',async()=>{
 const f=fixture();f.engine.change({data:{title:'첫'},body:'한글'});await f.tick(1900);assert.equal(f.calls.length,0);assert.ok(f.storage.size);
 await f.tick(100);assert.equal(f.calls.length,1);assert.equal(f.engine.revision,21);assert.equal(f.engine.savedAt,'2026-10-01T15:42:00+09:00');assert.equal(f.storage.size,0);assert.equal(f.engine.state,'saved');f.engine.dispose();
});
test('continuous typing saves by twelve seconds and retains only latest queued payload; flush serializes',async()=>{
 const f=fixture();for(let i=0;i<12;i++){f.engine.change({data:{title:String(i)},body:String(i)});await f.tick(1000);}assert.equal(f.calls.length,1);assert.equal(f.calls[0].body,'11');
 let resolve!: (d:Draft)=>void;let active=0,max=0;const calls:string[]=[];
 f.engine.save=async(rev,value)=>{calls.push(value.body);active++;max=Math.max(max,active);const d=await new Promise<Draft>(r=>{resolve=r;});active--;return d;};
 f.engine.change({data:{},body:'A'});const first=f.engine.flush();f.engine.change({data:{},body:'B'});f.engine.change({data:{},body:'C'});const second=f.engine.flush();
 resolve({...f.engine.draft,revision:22,value:{data:{},body:'A'}});await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['A','C']);
 resolve({...f.engine.draft,revision:23,value:{data:{},body:'C'}});await Promise.all([first,second]);assert.equal(max,1);assert.equal(f.engine.revision,23);f.engine.dispose();
});
test('network failures preserve input and emergency copy; retry works; stale tab freezes autosave without losing edits',async()=>{
 const f=fixture(),save=f.engine.save;f.engine.save=async()=>{throw new Error('network');};f.engine.change({data:{title:'유지'},body:'미저장'});await assert.rejects(f.engine.flush());assert.equal(f.engine.value.body,'미저장');assert.equal(f.engine.state,'unsaved');assert.ok(f.engine.recovery());
 f.engine.save=save;await f.engine.flush();assert.equal(f.engine.state,'saved');f.engine.save=async()=>{throw Object.assign(new Error('conflict'),{status:409});};
 f.engine.change({data:{},body:'내 입력'});await assert.rejects(f.engine.flush());assert.equal(f.engine.state,'conflict');f.engine.change({data:{},body:'계속 내 입력'});await f.tick(15000);assert.equal(f.engine.value.body,'계속 내 입력');assert.equal(f.engine.state,'conflict');assert.ok(f.engine.recovery());f.engine.dispose();
});
test('recovery detection survives clock skew and newer server revisions, never auto-overwrites',()=>{
 const f=fixture();f.local.setItem(f.engine.recoveryKey,JSON.stringify({revision:19,at:1,value:{data:{title:'미저장'},body:'복구'}}));
 assert.equal(f.engine.recovery()?.value.body,'복구');assert.equal(f.engine.value.body,'');assert.equal(f.calls.length,0);f.engine.dispose();
});

test('multi-tab recovery is isolated; stale save retains B while A acknowledgement clears only A; reload and orphan recovery work',async()=>{
 const f=fixture(),draft=f.engine.draft;let server=draft;
 const save=async(rev:number,value:Payload)=>{if(rev!==server.revision)throw Object.assign(new Error('conflict'),{status:409});server={...server,revision:rev+1,value};return server;};
 const a=new Autosave(draft,save,()=>{},f.local,f.clock,'A'),b=new Autosave(draft,save,()=>{},f.local,f.clock,'B');
 a.change({data:{title:'A'},body:'A'});b.change({data:{title:'B'},body:'B'});await a.flush();assert.equal(f.local.getItem(a.recoveryKey),null);assert.ok(f.local.getItem(b.recoveryKey));await assert.rejects(b.flush());assert.equal(b.state,'conflict');assert.ok(f.local.getItem(b.recoveryKey));
 const reload=new Autosave(server,save,()=>{},f.local,f.clock,'B');assert.equal(reload.recovery()?.value.body,'B');const crash=new Autosave(server,save,()=>{},f.local,f.clock,'new-session');assert.equal(crash.recovery()?.value.body,'B');crash.dismissRecovery(crash.recovery()!);assert.ok(f.local.getItem(b.recoveryKey));assert.equal(crash.recovery(),null);a.dispose();b.dispose();reload.dispose();crash.dispose();f.engine.dispose();
});
test('wrong acknowledgement revision never removes emergency input',async()=>{const f=fixture();f.engine.save=async(_revision,value)=>({...f.engine.draft,revision:999,value});f.engine.change({data:{},body:'keep'});await assert.rejects(f.engine.flush());assert.ok(f.local.getItem(f.engine.recoveryKey));assert.equal(f.engine.state,'unsaved');f.engine.dispose();});
