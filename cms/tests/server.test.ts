import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { Store } from '../server/store.ts';
import { Publisher, githubDeployment } from '../server/publish.ts';
import { createApp } from '../server/app.ts';
import { backup } from '../server/backup.ts';
import { renderPreview } from '../server/preview.ts';
import { readContent, publicSeries } from '../../src/lib/content.ts';
import { displayDate, publicationTime } from '../../src/lib/dates.ts';
import type { Draft, Payload } from '../shared.ts';
import { writeFixtureContent } from '../../tests/fixtures.ts';
const source = resolve('.');
const git = (cwd: string, args: string[]) => execFileSync('git', ['-c','user.name=Test','-c','user.email=test@example.invalid',...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function setup() {
  const temp = mkdtempSync(join(tmpdir(), 'mory-cms-test-')), root = join(temp, 'site'), remote = join(temp, 'remote.git');
  mkdirSync(root);
  cpSync(join(source,'.gitignore'),join(root,'.gitignore'));
  for (const dir of ['src', 'data']) cpSync(join(source, dir), join(root, dir), { recursive: true });
  writeFixtureContent(root);
  git(root, ['init', '-b', 'main']); git(root, ['add', '.']); git(root, ['commit', '-m', 'fixture']); git(temp, ['clone','--bare',root,remote]);
  git(root,['remote','add','origin',remote]);
  const store = new Store(root, join(temp, 'runtime'));
  let deployment: 'deploying' | 'complete' | 'failed' = 'deploying';
  const publisher = new Publisher(store, { remote, deployment: async () => ({ state: deployment }) });
  return { temp, root, remote, store, publisher, deployed: (state: typeof deployment) => { deployment = state; }, cleanup: () => { store.close(); rmSync(temp, { recursive: true, force: true }); } };
}
const modify = (store: Store, draft: Draft, patch: Record<string, any>, body = draft.value.body) => store.save(draft.key, draft.revision, { data: { ...draft.value.data, ...patch }, body });
async function publish(f: ReturnType<typeof setup>, draft: Draft, action: 'publish' | 'archive' | 'restore' | 'delete' = 'publish') {
  const job = f.publisher.request(draft.key, draft.revision, action); await f.publisher.idle(); return f.store.job(job.id);
}
test('SQLite autosave is an UPDATE with revision CAS; stale tabs get 409; draft survives failure and restart', () => {
  const f = setup();
  try {
    let draft = f.store.create('post'); assert.match(draft.id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/); assert.equal(draft.status,'초안');
    const first = draft; draft = modify(f.store,draft,{title:'자동 저장'}); assert.equal(draft.revision,first.revision+1); assert.ok(draft.saved_at.endsWith('+09:00'));
    assert.throws(() => modify(f.store,first,{title:'다른 탭'}), (e: any) => e.status===409);
    assert.equal(f.store.get(draft.key).value.data.title,'자동 저장');
    assert.equal((f.store.db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE key=?").get(draft.key) as any).n,1);
    const db = new Database(join(f.store.runtime,'cms.sqlite')); assert.equal((db.prepare('SELECT value FROM drafts WHERE key=?').get(draft.key) as any).value,JSON.stringify(draft.value)); db.close();
  } finally { f.cleanup(); }
});
test('exact revision publishing, independent documents, idempotent double taps, deployment distinction and lifecycle', async () => {
  const f = setup();
  try {
    const a = modify(f.store,f.store.list().find(d=>d.kind==='post'&&d.value.data.slug==='a-place-to-write')!,{title:'A 미게시'});
    let b = modify(f.store,f.store.create('post'),{title:'B',slug:'post-b',description:''},'## B 본문\n\n내용');
    assert.throws(()=>f.publisher.request(b.key,b.revision-1), (e:any)=>e.status===409);
    const job = f.publisher.request(b.key,b.revision); const duplicate = f.publisher.request(b.key,b.revision); assert.equal(job.id,duplicate.id);
    assert.throws(()=>modify(f.store,b,{title:'게시 중 입력'}),(e:any)=>e.status===423);
    await f.publisher.idle(); assert.equal(f.store.job(job.id).state,'deploying');
    assert.equal(readContent(f.publisher.repo).posts.find(p=>p.data.id===a.id)!.data.title,'글을 남기는 작은 공간');
    assert.equal(readContent(f.root).posts.some(p=>p.data.id===b.id),true);
    assert.equal(git(f.publisher.repo,['rev-list','--count','HEAD']),'2');
    b=f.store.get(b.key); assert.equal(b.status,'게시됨'); assert.match(b.value.data.publishedAt,/T\d{2}:\d{2}:\d{2}\+09:00$/); assert.equal(b.value.data.updatedAt,undefined);
    const publishedAt=b.value.data.publishedAt;
    b=modify(f.store,b,{title:'B 수정'}); assert.equal(b.status,'수정 중');
    f.deployed('failed'); assert.equal((await f.publisher.deployment(job.id)).state,'failed');
    const again=await publish(f,b); assert.equal(again.state,'deploying'); b=f.store.get(b.key); assert.equal(b.value.data.publishedAt,publishedAt); assert.match(b.value.data.updatedAt,/\+09:00$/);
    f.deployed('complete'); assert.equal((await f.publisher.deployment(again.id)).state,'complete');
    assert.throws(()=>modify(f.store,b,{slug:'new-b'}),/주소 변경/);
    b=f.store.save(b.key,b.revision,{...b.value,data:{...b.value.data,slug:'new-b'}},true); assert.ok(b.value.data.aliases.includes('post-b'));
    assert.equal((await publish(f,b)).state,'deploying'); b=f.store.get(b.key);
    assert.throws(()=>f.publisher.request(b.key,b.revision,'delete'),/보관된 글/);
    await publish(f,b,'archive'); b=f.store.get(b.key); assert.equal(b.status,'보관됨');
    await publish(f,b,'restore'); b=f.store.get(b.key); assert.equal(b.value.data.status,'published');
    await publish(f,b,'archive'); b=f.store.get(b.key); await publish(f,b,'delete'); assert.throws(()=>f.store.get(b.key),/찾지 못/);
    assert.ok(f.store.get(a.key).status==='수정 중');
  } finally { f.cleanup(); }
});
test('invalid schema and Markdown never commit; rejected push keeps SQLite; global publish mutex', async () => {
  const f=setup();
  try {
    let draft=modify(f.store,f.store.create('post'),{title:'실패',slug:'failure'},'[[missing]]');
    const before=git(f.root,['rev-parse','HEAD']);
    assert.equal((await publish(f,draft)).state,'failed'); assert.equal(git(f.publisher.repo,['rev-parse','HEAD']),before);
    assert.equal(f.store.get(draft.key).value.body,'[[missing]]');
    draft=modify(f.store,draft,{},'수정 후 내용');
    const hook=join(f.remote,'hooks/pre-receive'); writeFileSync(hook,'#!/bin/sh\nexit 1\n',{mode:0o755});
    assert.equal((await publish(f,draft)).state,'failed'); assert.equal(f.store.get(draft.key).status,'초안'); assert.equal(f.store.get(draft.key).value.body,'수정 후 내용');
    rmSync(hook); assert.equal((await publish(f,draft)).state,'deploying'); assert.equal(git(f.publisher.repo,['rev-list','--count','HEAD']),'2');
    const c=modify(f.store,f.store.create('post'),{title:'C',slug:'post-c'},'C'), d=modify(f.store,f.store.create('post'),{title:'D',slug:'post-d'},'D');
    let active=0,max=0; const sync=f.publisher.sync.bind(f.publisher); f.publisher.sync=async()=>{ active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));try{return await sync();}finally{active--;}};
    f.publisher.request(c.key,c.revision); f.publisher.request(d.key,d.revision);await f.publisher.idle();assert.equal(max,1);
    assert.ok(f.store.get(c.key).ever_published&&f.store.get(d.key).ever_published);
  } finally { f.cleanup(); }
});
test('external public file change blocks publishing; categories guard all statuses and unpublished definitions',async()=>{
 const f=setup();
 try {
   const draft=f.store.list().find(d=>d.kind==='post'&&d.ever_published)!;
   const changed=modify(f.store,draft,{title:'CMS 입력'});
   writeFileSync(join(f.root,draft.path),readFileSync(join(f.root,draft.path),'utf8')+'\n외부 수정');
   git(f.root,['add','.']);git(f.root,['commit','-m','external']);git(f.root,['push',f.remote,'main']);
   assert.equal((await publish(f,changed)).state,'conflict');assert.equal(f.store.get(draft.key).value.data.title,'CMS 입력');
   const cats=f.store.get('categories:registry');assert.throws(()=>f.store.save(cats.key,cats.revision,{data:{},body:''}),/분류를 사용하는 글/);
   const updated=f.store.save(cats.key,cats.revision,{data:{...cats.value.data,new:{name:'새 분류',order:20}},body:''});
   assert.throws(()=>modify(f.store,changed,{category:'new'}),/게시된 분류/);
   assert.equal((await publish(f,updated)).state,'deploying');assert.ok(f.store.get('categories:registry').published!.data.new);
 } finally{f.cleanup();}
});
test('many-to-many series, isolated series snapshots, deletion cleanup and Pages dynamic preview/publish',async()=>{
 const f=setup();
 try{
   let post=modify(f.store,f.store.create('post'),{title:'시리즈 글',slug:'series-post'},'## 글\n\n본문');await publish(f,post);post=f.store.get(post.key);
   let a=f.store.create('series','series-a'),b=f.store.create('series','series-b');
   a=modify(f.store,a,{name:'A',description:'',posts:[post.id]});b=modify(f.store,b,{name:'B',description:'B 설명',posts:[post.id]});
   await publish(f,a);await publish(f,b);assert.equal(publicSeries(readContent(f.publisher.repo)).filter(s=>s.posts.some(p=>p.data.id===post.id)).length,2);
   a=modify(f.store,f.store.get(a.key),{name:'A 미게시'});b=modify(f.store,f.store.get(b.key),{name:'B 공개'});await publish(f,b);
   assert.equal(readContent(f.publisher.repo).series['series-a'].name,'A');
   const page=f.store.get('page:home');const next=modify(f.store,page,{},'# 홈\n\n::recent-writing{count=2}\n\n::category-list\n\n::series-list\n\n::series-writing{id=series-a}\n\n::writing-search\n\n::writing-list');
   const preview=await renderPreview(f.store,page.key,next.value,'light');assert.match(preview,/<mory-search/);assert.match(preview,/series-a/);assert.match(preview,/class="series-writing"/);
   const postPreview=await renderPreview(f.store,post.key,{...post.value,body:'## 시리즈 안내\n\n::series-writing{id=series-a}'},'dark');assert.match(postPreview,/class="series-writing"/);assert.match(postPreview,/href="\/writing\/series-post\/"/);
   await publish(f,next); assert.equal(f.store.get(page.key).status,'게시됨');
   const about=modify(f.store,f.store.get('page:about'),{title:'소개'},'# 소개 수정');await publish(f,about);assert.equal(readContent(f.publisher.repo).pages.find(p=>p.key==='about')!.body,'# 소개 수정');
   await publish(f,post,'archive');post=f.store.get(post.key);assert.equal((await publish(f,post,'delete')).state,'deploying');
   assert.ok(Object.values(readContent(f.publisher.repo).series).every(s=>!s.posts.includes(post.id)));
   assert.equal(f.store.get(a.key).value.data.name,'A 미게시');assert.ok(!f.store.get(a.key).value.data.posts.includes(post.id));
   b=f.store.get(b.key);await publish(f,b,'delete');assert.equal(readContent(f.publisher.repo).posts.length,4);
 }finally{f.cleanup();}
});
test('draft-only archive/restore/delete stay local; backup API gives consistent retained snapshot',async()=>{
 const f=setup();try{
 let d=f.store.create('post');const localSeries=modify(f.store,f.store.create('series','local-series'),{name:'미게시 시리즈',posts:[d.id]});assert.equal((await publish(f,d,'archive')).state,'complete');d=f.store.get(d.key);assert.equal(d.status,'보관됨');
 await publish(f,d,'restore');d=f.store.get(d.key);assert.equal(d.status,'초안');await publish(f,d,'archive');d=f.store.get(d.key);
 const path=await backup(f.store,new Date('2026-10-01T15:00:00Z'));const db=new Database(path,{readonly:true});assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.ok(db.prepare('SELECT 1 FROM drafts WHERE key=?').get(d.key));db.close();
 await publish(f,d,'delete');assert.throws(()=>f.store.get(d.key),/찾지 못/);assert.equal(existsSync(f.publisher.repo),false);assert.deepEqual(f.store.get(localSeries.key).value.data.posts,[]);
 }finally{f.cleanup();}
});
test('API origin/host checks, stale HTTP409, shared preview and script isolation',async()=>{
 const f=setup();try{
 const origin='http://127.0.0.1:40009',app=createApp(f.store,f.publisher,origin),d=f.store.create('post');
 const send=(path:string,method:string,body:any,headers:Record<string,string>={})=>app.request(origin+path,{method,headers:{host:'127.0.0.1:40009','Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(body)});
 assert.equal((await send('/api/drafts/'+d.key,'PUT',{revision:0,value:d.value})).status,400);
 assert.equal((await send('/api/drafts/'+d.key,'PUT',{revision:d.revision,value:d.value},{Origin:'https://evil.invalid'})).status,403);
 assert.equal((await send('/api/drafts/'+d.key,'PUT',{revision:d.revision,value:d.value},{host:'evil.invalid'})).status,403);
 assert.equal((await send('/api/drafts/'+d.key,'PUT',{revision:d.revision,value:d.value})).status,200);
 assert.equal((await send('/api/drafts/'+d.key,'PUT',{revision:d.revision,value:d.value})).status,409);
 const preview=await send('/api/preview/'+d.key,'POST',{value:{...d.value,body:'## 목차\n\n==강조==\n\n> [!note]\n> 내용\n\n<script>alert(1)</script>'},theme:'dark'});assert.equal(preview.status,200);const view=await preview.json() as {url:string};const html=await (await app.request(origin+view.url,{headers:{host:'127.0.0.1:40009'}})).text();assert.match(html,/<mark>강조<\/mark>/);assert.match(html,/목차/);assert.doesNotMatch(html,/alert\(1\)/);
 }finally{f.cleanup();}
});
test('Seoul timestamps and offset instant order are host-timezone independent',()=>{
 const expected='2026-10-01T15:42:00+09:00';assert.equal(publicationTime(new Date('2026-10-01T06:42:00Z')),expected);assert.equal(displayDate(expected),'2026.10.01 15:42');
 for(const TZ of ['UTC','Asia/Seoul','America/Los_Angeles','Pacific/Apia']){
 const output=execFileSync(process.execPath,['--input-type=module','-e',"import {publicationTime,displayDate} from './src/lib/dates.ts'; console.log(publicationTime(new Date('2026-10-01T06:42:00Z')),displayDate('2026-10-01T06:42:00+00:00'))"],{cwd:source,env:{...process.env,TZ},encoding:'utf8'}).trim();assert.equal(output,expected+' 2026.10.01 15:42');
 }
});
test('GitHub status is matched to SHA and workflow; API outage never declares completion',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async(input,options)=>{assert.ok(!(options?.headers as any).Authorization);if(String(input).includes('status=success')) {assert.match(String(input),/branch=main/);return new Response(JSON.stringify({workflow_runs:[]}));}assert.match(String(input),/workflows\/deploy.yml\/runs\?head_sha=abc/);return new Response(JSON.stringify({workflow_runs:[{head_sha:'other',status:'completed',conclusion:'success',run_attempt:1},{head_sha:'abc',status:'completed',conclusion:'failure',html_url:'https://github.com/run',run_attempt:1}]}));};
 assert.equal((await githubDeployment('git@github.com:braininavat06/mory.git')('abc')).state,'failed');
 globalThis.fetch=async()=>new Response('',{status:403});await assert.rejects(githubDeployment('git@github.com:braininavat06/mory.git')('abc'));
 }finally{globalThis.fetch=original;}
});

test('a successful descendant deployment resolves historical failures; unrelated success and API outage do not',async()=>{
 const original=globalThis.fetch;
 try {
  for(const status of ['ahead','behind','diverged']) {
   globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.includes('/compare/'))return new Response(JSON.stringify({status,merge_base_commit:{sha:status==='ahead'?'old':'other'}}));
    const latest=url.includes('status=success');
    return new Response(JSON.stringify({workflow_runs:[{head_sha:latest?'new':'old',status:'completed',conclusion:latest?'success':'failure',html_url:latest?'https://github.com/new':'https://github.com/old',run_attempt:1}]}));
   };
   const result=await githubDeployment('git@github.com:braininavat06/mory.git')('old');
   assert.equal(result.state,status==='ahead'?'superseded':'failed');assert.equal(result.url,status==='ahead'?'https://github.com/new':'https://github.com/old');
  }
  globalThis.fetch=async(input)=>String(input).includes('/compare/')?new Response('',{status:403}):new Response(JSON.stringify({workflow_runs:[{head_sha:String(input).includes('status=success')?'new':'old',status:'completed',conclusion:String(input).includes('status=success')?'success':'failure',run_attempt:1}]}));
  await assert.rejects(githubDeployment('git@github.com:braininavat06/mory.git')('old'));
 } finally {globalThis.fetch=original;}
});
test('historical deployment failure resolves without republishing drafts or rerunning the obsolete workflow',async()=>{
 const f=setup();try {
  const d=modify(f.store,f.store.create('post'),{title:'이전 배포',slug:'historical'},'내용');const job=await publish(f,d);
  f.store.updateJob(job.id,{state:'failed',run_url:'https://github.com/old',error:'이전 실패'});
  const before=f.store.get(d.key);f.publisher.options.deployment=async()=>({state:'superseded',url:'https://github.com/new'});
  let retries=0;f.publisher.options.retryDeployment=async()=>{retries++;};
  assert.equal((await f.publisher.retryDeployment(job.id)).state,'superseded');assert.equal(retries,0);
  assert.deepEqual(f.store.get(d.key),before);assert.equal(f.store.job(job.id).error,null);assert.equal(f.store.job(job.id).run_url,'https://github.com/new');
 }finally{f.cleanup();}
});
test('uncertain push acknowledgement and restart recover the same commit without duplicate publication',async()=>{
 const f=setup();try{
 let d=modify(f.store,f.store.create('post'),{title:'응답 단절',slug:'lost-response'},'내용');
 const realGit=f.publisher.git.bind(f.publisher);let lose=true, loseFetch=false;
 f.publisher.git=async(args,cwd)=>{if(args[0]==='fetch'&&loseFetch){loseFetch=false;throw new Error('temporarily unavailable');}const result=await realGit(args,cwd);if(args[0]==='push'&&lose){lose=false;loseFetch=true;throw new Error('lost response');}return result;};
 const failed=await publish(f,d);assert.equal(failed.state,'failed');assert.equal(f.store.get(d.key).status,'초안');
 f.store.updateJob(failed.id,{state:'publishing'});
 const restarted=new Publisher(f.store,f.publisher.options);restarted.resume();await restarted.idle();
 assert.equal(f.store.job(failed.id).state,'deploying');assert.equal(git(restarted.repo,['rev-list','--count','HEAD']),'2');
 assert.equal(f.store.get(d.key).status,'게시됨');
 }finally{f.cleanup();}
});
test('external conflict reload is explicit, updates base hash, and allows corrected publishing',async()=>{
 const f=setup();try{
 const d=f.store.list().find(d=>d.kind==='post'&&d.ever_published)!;const changed=modify(f.store,d,{title:'내 작업'});
 writeFileSync(join(f.root,d.path),readFileSync(join(f.root,d.path),'utf8')+'\n외부 수정');git(f.root,['add','.']);git(f.root,['commit','-m','outside']);git(f.root,['push',f.remote,'main']);
 assert.equal((await publish(f,changed)).state,'conflict');
 const latest=await f.publisher.reloadPublic(d.key,changed.revision);assert.match(latest.value.body,/외부 수정/);assert.equal(latest.revision,changed.revision+1);
 const corrected=modify(f.store,latest,{title:'확인 후 새 작업'});assert.equal((await publish(f,corrected)).state,'deploying');
 }finally{f.cleanup();}
});
test('backup keeps seven daily and bounded weekly snapshots; no partial snapshots are accepted',async()=>{
 const f=setup();try{
 for(let i=0;i<=70;i++)await backup(f.store,new Date(Date.UTC(2026,7,1+i,3)));
 const {readdirSync}=await import('node:fs');const files=readdirSync(join(f.store.runtime,'backups'));assert.ok(files.length<=16);assert.ok(files.length>=7);assert.ok(files.every(n=>n.endsWith('.sqlite')));
 }finally{f.cleanup();}
});

test('failed deployment retry reuses its job, requires server authority and never creates a content commit', async () => {
  const f=setup(); try {
    const d=modify(f.store,f.store.create('post'),{title:'배포 재시도',slug:'deploy-retry'},'내용');const job=await publish(f,d);
    f.deployed('failed');
    f.store.updateJob(job.id,{state:'failed',run_url:'https://github.com/braininavat06/mory/actions/runs/123',error:'배포 실패'});
    const origin='http://127.0.0.1:40009',app=createApp(f.store,f.publisher,origin);
    const state=async()=> (await app.request(origin+'/api/state',{headers:{host:'127.0.0.1:40009'}})).json();
    assert.equal((await state()).canRetryDeployment,false);
    await assert.rejects(f.publisher.retryDeployment(job.id),/서버의 GitHub 권한/);
    let calls=0;f.publisher.options.retryDeployment=async()=>{calls++;await new Promise(r=>setTimeout(r,10));};
    assert.equal((await state()).canRetryDeployment,true);
    const count=git(f.publisher.repo,['rev-list','--count','HEAD']);await Promise.all([f.publisher.retryDeployment(job.id),f.publisher.retryDeployment(job.id)]);
    assert.equal(calls,1);assert.equal(f.store.job(job.id).state,'deploying');assert.equal(git(f.publisher.repo,['rev-list','--count','HEAD']),count);
  }finally{f.cleanup();}
});

test('slug editing preserves published aliases without leaking intermediate autosaves or colliding on revert', () => {
  const f=setup();try {
    const original=f.store.list().find(d=>d.kind==='post'&&d.ever_published)!;
    let d=f.store.save(original.key,original.revision,{...original.value,data:{...original.value.data,slug:'intermediate'}},true);
    d=f.store.save(d.key,d.revision,{...d.value,data:{...d.value.data,slug:'final-address'}},true);
    assert.ok(d.value.data.aliases.includes(original.value.data.slug));assert.ok(!d.value.data.aliases.includes('intermediate'));
    d=f.store.save(d.key,d.revision,{...d.value,data:{...d.value.data,slug:original.value.data.slug}},true);
    assert.ok(!d.value.data.aliases.includes(d.value.data.slug));
  }finally{f.cleanup();}
});
