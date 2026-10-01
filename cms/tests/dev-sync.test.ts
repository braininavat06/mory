import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Store } from '../server/store.ts';
import { Publisher } from '../server/publish.ts';
import { remoteIdentity } from '../server/dev-sync.ts';
import { createApp } from '../server/app.ts';
import { writeFixtureContent } from '../../tests/fixtures.ts';
import { CONTENT_CONTRACT_VERSION } from '../../src/lib/content-contract.ts';
const git = (cwd: string, args: string[]) => execFileSync('git', ['-c','user.name=Test','-c','user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
function setup() {
  const temp = mkdtempSync(join(tmpdir(), 'mory-sync-')), root = join(temp, 'dev'), remote = join(temp,'remote.git'), other = join(temp,'other');
  mkdirSync(root);
  for (const path of ['src','.gitignore']) cpSync(join(resolve('.'),path),join(root,path),{recursive:true});
  writeFixtureContent(root);
  writeFileSync(join(root,'code.ts'),'base\n');
  git(root,['init','-b','main']);git(root,['add','.']);git(root,['commit','-m','initial']);
  git(temp,['clone','--bare',root,remote]);git(root,['remote','add','origin',remote]);git(temp,['clone',remote,other]);
  const runtime=join(root,'runtime'),store=new Store(root,runtime);
  const publisher=new Publisher(store,{remote,branch:'main',deployment:async()=>({state:'complete'})});
  const draft=store.create('post');const post=store.save(draft.key,draft.revision,{data:{...draft.value.data,title:'새 게시',slug:'sync-post'},body:'## 본문\n\nSQLite 작업본'});
  return {temp,root,remote,other,runtime,store,publisher,post,close(){store.close();rmSync(temp,{recursive:true,force:true});}};
}
type Fixture=ReturnType<typeof setup>;
async function publish(f:Fixture) {const job=f.publisher.request(f.post.key,f.post.revision);await f.publisher.idle();return f.store.job(job.id);}
function advance(f:Fixture,path='remote-code.ts',text='remote\n') {
  git(f.other,['fetch','origin']);git(f.other,['merge','--ff-only','origin/main']);
  writeFileSync(join(f.other,path),text);git(f.other,['add','--',path]);git(f.other,['commit','-m','external update']);git(f.other,['push','origin','main']);
  return git(f.other,['rev-parse','HEAD']);
}
function invariant(f:Fixture,sha:string) {
  git(f.root,['merge-base','--is-ancestor',sha,'HEAD']);
  assert.equal(git(f.root,['rev-parse','HEAD']),git(f.remote,['rev-parse','main']));
  assert.equal(f.store.localSync()?.pending,false);
}

test('clean checkout advances after content-only publication; duplicate revision is idempotent',async()=>{
 const f=setup();try{
  const job=f.publisher.request(f.post.key,f.post.revision);assert.equal(f.publisher.request(f.post.key,f.post.revision).id,job.id);await f.publisher.idle();
  const result=f.store.job(job.id);assert.equal(result.state,'deploying');invariant(f,result.commit_sha!);
  const revision=f.store.get(f.post.key).revision;f.publisher.request(f.post.key,f.post.revision);await f.publisher.idle();
  assert.equal(f.store.get(f.post.key).revision,revision);assert.equal(git(f.remote,['rev-list','--count','main']),'2');
  assert.equal(git(f.remote,['diff-tree','--no-commit-id','--name-only','-r',result.commit_sha!]),f.post.path);
 }finally{f.close();}
});
test('staged, partially staged, unstaged, binary, renamed and untracked code survive; Backup add/commit/push needs no pull',async()=>{
 const f=setup();try{
  writeFileSync(join(f.root,'code.ts'),'staged\n');git(f.root,['add','code.ts']);writeFileSync(join(f.root,'code.ts'),'staged and unstaged\n');
  writeFileSync(join(f.root,'binary.dat'),Buffer.from([0,1,0,2]));git(f.root,['add','binary.dat']);
  writeFileSync(join(f.root,'notes.txt'),'untracked\n');git(f.root,['mv','src/scripts/toc.ts','src/scripts/toc-renamed.ts']);
  writeFileSync(join(f.root,'src/scripts/search.ts'),readFileSync(join(f.root,'src/scripts/search.ts'),'utf8')+'\n// local edit\n');
  git(f.root,['config','merge.autoStash','true']);
  writeFileSync(join(f.root,'.git/hooks/post-merge'),'#!/bin/sh\necho touched > hook-ran\n',{mode:0o755});
  const commands:string[][]=[];const devGit=f.publisher.dev.git.bind(f.publisher.dev);f.publisher.dev.git=async args=>{commands.push(args);return devGit(args);};
  const before=await f.publisher.dev.snapshot();const job=await publish(f);assert.equal(job.state,'deploying');
  assert.deepEqual(await f.publisher.dev.snapshot(),before);invariant(f,job.commit_sha!);
  assert.equal(existsSync(join(f.root,'hook-ran')),false);assert.equal(git(f.root,['stash','list']),'');
  assert.ok(commands.every(args=>!args.some(arg=>['reset','rebase','stash','checkout','restore','clean','push'].includes(arg))));
  mkdirSync(join(f.runtime,'backups'),{recursive:true});writeFileSync(join(f.runtime,'backups','manual.sqlite'),'fixture');
  git(f.root,['add','.']);assert.doesNotMatch(git(f.root,['diff','--cached','--name-only']),/^runtime\//m);
  git(f.root,['commit','-m','code update from unchanged Backup flow']);git(f.root,['push','origin','main']);
  assert.equal(git(f.remote,['rev-list','--count','main']),'3');assert.equal(git(f.root,['rev-parse','HEAD']),git(f.remote,['rev-parse','main']));
  assert.equal(git(f.root,['ls-files','runtime/']),'');
 }finally{f.close();}
});
test('managed staged, unstaged and untracked Markdown/YAML are blocked before any remote change',async()=>{
 for(const mode of ['staged','unstaged','untracked','ignored']){
  const f=setup();try{
   const isNew=mode==='untracked'||mode==='ignored',path=isNew?'data/series/local.yaml':'src/content/pages/about.md';
   if(mode==='ignored')writeFileSync(join(f.root,'.gitignore'),readFileSync(join(f.root,'.gitignore'),'utf8')+'\ndata/series/local.yaml\n');
   writeFileSync(join(f.root,path),isNew?'id: local\n':readFileSync(join(f.root,path),'utf8')+'\nlocal');
   if(mode==='staged')git(f.root,['add',path]);const before=git(f.remote,['rev-parse','main']);
   const job=await publish(f);assert.equal(job.state,'failed');assert.match(job.error!,/공개 콘텐츠.*로컬 수정/);assert.equal(git(f.remote,['rev-parse','main']),before);
  }finally{f.close();}
 }
});
test('behind checkout fast-forwards before publishing without changing a staged code patch',async()=>{
 const f=setup();try{
  advance(f);writeFileSync(join(f.root,'code.ts'),'pending code\n');git(f.root,['add','code.ts']);
  const snapshot=await f.publisher.dev.snapshot();const job=await publish(f);
  assert.equal(job.state,'deploying');assert.deepEqual(await f.publisher.dev.snapshot(),snapshot);invariant(f,job.commit_sha!);
  assert.ok(existsSync(join(f.root,'remote-code.ts')));
 }finally{f.close();}
});
test('ahead and diverged checkouts block publication and never push the user commit',async()=>{
 for(const diverged of [false,true]){
  const f=setup();try{
   writeFileSync(join(f.root,'code.ts'),'local commit\n');git(f.root,['add','code.ts']);git(f.root,['commit','-m','not pushed']);
   if(diverged)advance(f);const before=git(f.remote,['rev-parse','main']),head=git(f.root,['rev-parse','HEAD']);
   const job=await publish(f);assert.equal(job.state,'failed');assert.match(job.error!,/원격에 반영되지 않은 커밋/);
   assert.equal(git(f.remote,['rev-parse','main']),before);assert.equal(git(f.root,['rev-parse','HEAD']),head);
  }finally{f.close();}
 }
});
test('wrong branch and detached HEAD are blocked without changing branches',async()=>{
 for(const detached of [false,true]){
  const f=setup();try{
   git(f.root,detached?['checkout','--detach']:['checkout','-b','feature']);const head=git(f.root,['rev-parse','HEAD']);
   const job=await publish(f);assert.equal(job.state,'failed');assert.match(job.error!,/브랜치/);assert.equal(git(f.root,['rev-parse','HEAD']),head);
  }finally{f.close();}
 }
});
test('Git operation markers, locks and actual unresolved index entries block before push',async()=>{
 for(const marker of ['MERGE_HEAD','rebase-merge','CHERRY_PICK_HEAD','REVERT_HEAD','BISECT_LOG','sequencer','index.lock','unmerged']){
  const f=setup();try{
   const before=git(f.remote,['rev-parse','main']);
   if(marker==='unmerged'){
    const blob=git(f.root,['rev-parse','HEAD:code.ts']);
    execFileSync('git',['update-index','--index-info'],{cwd:f.root,input:`0 ${'0'.repeat(40)}\tcode.ts\n100644 ${blob} 1\tcode.ts\n100644 ${blob} 2\tcode.ts\n100644 ${blob} 3\tcode.ts\n`});
   }else if(['rebase-merge','sequencer'].includes(marker))mkdirSync(join(f.root,'.git',marker));
   else writeFileSync(join(f.root,'.git',marker),before);
   const job=await publish(f);assert.equal(job.state,'failed');assert.match(job.error!,/진행 중|충돌/);assert.equal(git(f.remote,['rev-parse','main']),before);
  }finally{f.close();}
 }
});
test('missing/mismatched origin, damaged repo and unignored runtime block publication',async()=>{
 for(const mode of ['missing','mismatch','extra-push','damaged','ignore']){
  const f=setup();try{
   if(mode==='missing')git(f.root,['remote','remove','origin']);
   if(mode==='mismatch'){const wrong=join(f.temp,'wrong.git');git(f.temp,['clone','--bare',f.root,wrong]);git(f.root,['remote','set-url','origin',wrong]);}
   if(mode==='extra-push'){const wrong=join(f.temp,'wrong.git');git(f.temp,['clone','--bare',f.root,wrong]);git(f.root,['remote','set-url','--add','--push','origin',f.remote]);git(f.root,['remote','set-url','--add','--push','origin',wrong]);}
   if(mode==='damaged')rmSync(join(f.root,'.git','HEAD'));
   if(mode==='ignore')writeFileSync(join(f.root,'.gitignore'),'node_modules/\n');
   const before=git(f.remote,['rev-parse','main']);assert.equal((await publish(f)).state,'failed');assert.equal(git(f.remote,['rev-parse','main']),before);
  }finally{f.close();}
 }
});
test('incoming code overlaps local work: preflight refuses; configured autostash and hooks never run',async()=>{
 const f=setup();try{
  advance(f,'code.ts','remote code\n');writeFileSync(join(f.root,'code.ts'),'local code\n');git(f.root,['add','code.ts']);git(f.root,['config','merge.autoStash','true']);
  writeFileSync(join(f.root,'.git/hooks/post-merge'),'#!/bin/sh\necho touched > hook-ran\n',{mode:0o755});
  const before=await f.publisher.dev.snapshot(),head=git(f.root,['rev-parse','HEAD']);const job=await publish(f);
  assert.equal(job.state,'failed');assert.match(job.error!,/로컬 작업이 겹쳐/);assert.deepEqual(await f.publisher.dev.snapshot(),before);assert.equal(git(f.root,['rev-parse','HEAD']),head);
  assert.equal(existsSync(join(f.root,'hook-ran')),false);assert.equal(git(f.root,['stash','list']),'');
 }finally{f.close();}
});
test('ignored local files and remote runtime tracking/ignore removal are rejected before checkout',async()=>{
 for(const mode of ['ignored','runtime','ignore-removed']){
  const f=setup();try{
   if(mode==='ignored'){
    writeFileSync(join(f.root,'.gitignore'),readFileSync(join(f.root,'.gitignore'),'utf8')+'\nprivate-code.ts\n');
    writeFileSync(join(f.root,'private-code.ts'),'private working copy');advance(f,'private-code.ts','remote copy');
   }else if(mode==='ignore-removed')advance(f,'.gitignore','node_modules/\n');
   else {
    mkdirSync(join(f.other,'runtime'));writeFileSync(join(f.other,'runtime','tracked.txt'),'bad');git(f.other,['add','-f','runtime/tracked.txt']);git(f.other,['commit','-m','invalid runtime tracking']);git(f.other,['push','origin','main']);
   }
   const head=git(f.root,['rev-parse','HEAD']);const job=await publish(f);assert.equal(job.state,'failed');assert.equal(git(f.root,['rev-parse','HEAD']),head);
   if(mode==='ignored')assert.equal(readFileSync(join(f.root,'private-code.ts'),'utf8'),'private working copy');
  }finally{f.close();}
 }
});
test('runtime compatibility is checked from the fetched commit, not updated files on disk',async()=>{
 for(const version of [CONTENT_CONTRACT_VERSION+1,CONTENT_CONTRACT_VERSION-1]) {
  const f=setup();try{
   advance(f,'src/lib/content-contract.ts','export const CONTENT_CONTRACT_VERSION = '+version+';\n');const head=git(f.root,['rev-parse','HEAD']);
   const job=await publish(f);assert.equal(job.state,'failed');assert.match(job.error!,version>CONTENT_CONTRACT_VERSION?/실행 중인 CMS.*지원하지/:/사이트 업데이트/);assert.equal(git(f.root,['rev-parse','HEAD']),head);
  }finally{f.close();}
 }
});
test('a code push racing after preflight is fetched, revalidated and retried without duplicate content commits',async()=>{
 const f=setup();try{
  const original=f.publisher.git.bind(f.publisher);let pushes=0;
  f.publisher.git=async(args,cwd)=>{if(args[0]==='push'&&++pushes===1)advance(f);return original(args,cwd);};
  const job=await publish(f);assert.equal(job.state,'deploying');assert.equal(pushes,2);invariant(f,job.commit_sha!);
  assert.equal(git(f.remote,['rev-list','--count','main']),'3');assert.equal(git(f.remote,['log','--format=%s','--grep=content: publish']),'content: publish post');
 }finally{f.close();}
});
test('a target-content race aborts instead of overwriting; repeated unrelated races are bounded',async()=>{
 for(const target of [true,false]){
  const f=setup();try{
   const original=f.publisher.git.bind(f.publisher);let pushes=0;
   f.publisher.git=async(args,cwd)=>{if(args[0]==='push'){pushes++;advance(f,target?f.post.path:`race-${pushes}.ts`,target?`---\nid: "${f.post.id}"\ntitle: External\nslug: sync-post\ncategory: sample\npublishedAt: 2026-10-01\nstatus: published\ndescription: ""\naliases: []\n---\nexternal body`:'external');}return original(args,cwd);};
   const job=await publish(f);assert.equal(job.state,target?'conflict':'failed');assert.match(job.error!,target?/외부에서 변경/:/동시에 변경/);assert.equal(pushes,target?1:3);
   assert.equal(git(f.remote,['log','--format=%s','--grep=content: publish']),'');assert.equal(f.store.get(f.post.key).value.body,f.post.value.body);
  }finally{f.close();}
 }
});
test('successful content push survives a concurrent local commit; pending persists and deployment success stays success',async()=>{
 const f=setup();try{
  const original=f.publisher.git.bind(f.publisher);
  f.publisher.git=async(args,cwd)=>{const result=await original(args,cwd);if(args[0]==='push'){writeFileSync(join(f.root,'code.ts'),'concurrent\n');git(f.root,['add','code.ts']);git(f.root,['commit','-m','concurrent local']);}return result;};
  const job=await publish(f);assert.equal(job.state,'deploying');assert.ok(job.pushed_at);assert.equal(f.store.localSync()?.pending,true);
  assert.equal((await f.publisher.deployment(job.id)).state,'complete');assert.equal(f.store.localSync()?.pending,true);
  assert.equal(git(f.remote,['rev-parse','main']),job.commit_sha);assert.equal(f.store.get(f.post.key).ever_published,true);
  const observer=new Store(f.root,f.runtime);assert.equal(observer.localSync()?.publication_sha,job.commit_sha);observer.close();
  const next=f.store.create('post');f.publisher.request(next.key,next.revision);await f.publisher.idle();
  assert.match(f.store.jobs()[0].error!,/동기화가 아직 필요/);assert.equal(git(f.remote,['rev-parse','main']),job.commit_sha);
 }finally{f.close();}
});
test('pending caused by a transient post-push lock recovers at restart and before next publish',async()=>{
 for(const restart of [true,false]){
  const f=setup();try{
   const original=f.publisher.git.bind(f.publisher);let locked=false;
   f.publisher.git=async(args,cwd)=>{const result=await original(args,cwd);if(args[0]==='push'&&!locked){locked=true;writeFileSync(join(f.root,'.git/index.lock'),'busy');}return result;};
   const job=await publish(f);assert.equal(job.state,'deploying');assert.equal(f.store.localSync()?.pending,true);rmSync(join(f.root,'.git/index.lock'));
   if(restart){const service=new Publisher(f.store,f.publisher.options);service.resume();await service.idle();}
   else {const d=f.store.create('post');const next=f.store.save(d.key,d.revision,{data:{...d.value.data,title:'다음 게시',slug:'next'},body:'next'});f.publisher.request(next.key,next.revision);await f.publisher.idle();assert.equal(f.store.jobs()[0].state,'deploying');}
   invariant(f,job.commit_sha!);
  }finally{f.close();}
 }
});
test('post-push remote advances: latest safe code is included, overlapping code becomes a pending warning',async()=>{
 for(const overlap of [false,true]){
  const f=setup();try{
   if(overlap)writeFileSync(join(f.root,'code.ts'),'local unsaved\n');
   const original=f.publisher.git.bind(f.publisher);let remote='';
   f.publisher.git=async(args,cwd)=>{const result=await original(args,cwd);if(args[0]==='push')remote=advance(f,overlap?'code.ts':'after.ts','after');return result;};
   const job=await publish(f);assert.equal(job.state,'deploying');assert.equal(f.store.localSync()?.pending,overlap);assert.equal(f.store.localSync()?.remote_sha,remote);
   if(!overlap)invariant(f,job.commit_sha!);else assert.equal(readFileSync(join(f.root,'code.ts'),'utf8'),'local unsaved\n');
  }finally{f.close();}
 }
});
test('same GitHub repository normalizes HTTPS/SSH without credentials; local repository identities remain distinct',()=>{
 assert.equal(remoteIdentity('https://github.com/BrainInAVat06/mory.git','.'),remoteIdentity('git@github.com:braininavat06/mory.git','.'));
 assert.equal(remoteIdentity('ssh://git@github.com/braininavat06/mory.git','.'),remoteIdentity('https://github.com/braininavat06/mory','.'));
});
test('manual sync retry shares publish queue and API reports sync warning separately from a complete deployment',async()=>{
 const f=setup();try{
  const original=f.publisher.git.bind(f.publisher);
  f.publisher.git=async(args,cwd)=>{const result=await original(args,cwd);if(args[0]==='push')writeFileSync(join(f.root,'.git/index.lock'),'busy');return result;};
  const job=await publish(f);await f.publisher.deployment(job.id);const origin='http://127.0.0.1:40009',app=createApp(f.store,f.publisher,origin);
  const state=await (await app.request(origin+'/api/state',{headers:{host:'127.0.0.1:40009'}})).json();
  assert.equal(state.jobs[0].state,'complete');assert.equal(state.localSync.pending,true);
  rmSync(join(f.root,'.git/index.lock'));
  const response=await app.request(origin+'/api/local-sync/retry',{method:'POST',headers:{host:'127.0.0.1:40009',Origin:origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,200);assert.equal((await response.json()).pending,false);invariant(f,job.commit_sha!);
 }finally{f.close();}
});
test('interruption after a known successful push remains recoverable, never becomes publish failed',async()=>{
 const f=setup();try{
  f.publisher.finishPush=async()=>{throw new Error('interrupted bookkeeping');};
  const job=await publish(f);assert.equal(job.state,'publishing');assert.ok(job.pushed_at);assert.equal(git(f.remote,['rev-parse','main']),job.commit_sha);
  const restarted=new Publisher(f.store,f.publisher.options);restarted.resume();await restarted.idle();
  assert.equal(f.store.job(job.id).state,'deploying');invariant(f,job.commit_sha!);assert.equal(git(f.remote,['rev-list','--count','main']),'2');
 }finally{f.close();}
});
test('late push acknowledgement records the publication hash, not a newer external content edit',async()=>{
 const f=setup();try{
  const original=f.publisher.git.bind(f.publisher);let interrupted=false;
  f.publisher.git=async(args,cwd)=>{
   const result=await original(args,cwd);
   if(args[0]==='push'&&!interrupted){interrupted=true;advance(f,f.post.path,readFileSync(join(f.publisher.repo,f.post.path),'utf8')+'\nexternal after publication');throw new Error('response lost');}
   return result;
  };
  const job=await publish(f);assert.equal(job.state,'deploying');invariant(f,job.commit_sha!);
  const latest=f.store.get(f.post.key),next=f.store.save(latest.key,latest.revision,{...latest.value,body:'CMS next edit'});
  const second=f.publisher.request(next.key,next.revision);await f.publisher.idle();
  assert.equal(f.store.job(second.id).state,'conflict');assert.match(f.store.job(second.id).error!,/외부에서 변경/);
  assert.match(git(f.other,['show','origin/main:'+f.post.path]),/external after publication/);
  assert.equal(git(f.remote,['rev-list','--count','main']),'3');
 }finally{f.close();}
});
